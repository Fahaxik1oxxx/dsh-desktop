// main.js — Electron 主进程：拉起 dsh 服务器、加载其 web UI、托盘常驻、检测并执行更新。
const { app, BrowserWindow, Tray, Menu, dialog, Notification, nativeImage, shell, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer, waitForPort } = require('./server.js');
const { makeUpdater, headSha } = require('./updater.js');
const { loadConfig } = require('./config-lib.js');
const { parseDshWebUrl } = require('./web-url.js');

const cfg = loadConfig(path.join(__dirname, 'config.json'));
// 自绘窗口控制按钮的 IPC（preload 经 contextBridge 暴露给页面，渲染端无 node 权限）
ipcMain.handle('dsh-window:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
ipcMain.handle('dsh-window:toggle-maximize', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('dsh-window:close', () => { if (win && !win.isDestroyed()) win.close(); }); // 走既有关窗到托盘逻辑
ipcMain.handle('dsh-update:state', () => updateState);
ipcMain.handle('dsh-update:apply', () => applyAvailableUpdate());
ipcMain.handle('dsh-update:dismiss', () => { dismissUpdate(); return updateState; });

const LOG = path.join(__dirname, 'app.log');
const SHELL_UPDATE_JS = fs.readFileSync(path.join(__dirname, 'shell-update.js'), 'utf8');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    try { if (fs.statSync(LOG).size > 1048576) fs.truncateSync(LOG, 0); } catch { /* 日志不存在则直接创建 */ }
    fs.appendFileSync(LOG, line + '\n');
  } catch { /* 忽略写日志失败 */ }
  // eslint-disable-next-line no-console
  console.log(line);
}
function short(s) { return (s || '').slice(0, 8); }

let win = null;
let tray = null;
let server = null;
let updater = null;
let quitting = false;

// 自绘窗口控制：叠在右栏顶上，不另开一栏（对齐 ZCode 左右两栏）。
const CONTROL_HEIGHT = 36;
const CONTROL_WIDTH = 138;
const DRAG_HEIGHT = 12; // 会话头 padding-top，不挡住标题和按钮

/**
 * 注入到页面的自绘窗口控制按钮。本函数会被序列化后在渲染端执行，只能引用 DOM/window。
 * @param {boolean} initialMaximized
 * @param {number} controlHeight
 * @param {number} controlWidth
 */
function installWindowControls(initialMaximized, controlHeight, controlWidth) {
  if (document.getElementById('dsh-win-controls') || !window.dshWindow) return;
  const strip = document.createElement('div');
  strip.id = 'dsh-win-controls';
  strip.style.cssText = 'position:fixed;top:0;right:0;width:' + controlWidth + 'px;height:' + controlHeight + 'px;z-index:2147483647;display:flex;-webkit-app-region:no-drag;color:#4a4f57;';
  const style = document.createElement('style');
  style.textContent =
    '.dsh-wc{flex:1 1 0;height:' + controlHeight + 'px;border:0;padding:0;margin:0;background:transparent;color:inherit;' +
    'display:flex;align-items:center;justify-content:center;border-radius:0;box-shadow:none;font:inherit;}' +
    '.dsh-wc:hover{background:rgba(0,0,0,0.055);}' +
    '.dsh-wc:active{background:rgba(0,0,0,0.1);}' +
    '.dsh-wc-close:hover{background:#e81123;color:#fff !important;}' +
    '.dsh-wc-close:active{background:#f1707a;color:#fff !important;}' +
    '.dsh-wc svg{display:block;pointer-events:none;}';
  strip.appendChild(style);
  const mk = (cls, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dsh-wc ' + cls;
    b.title = title;
    return b;
  };
  const minB = mk('dsh-wc-min', '最小化');
  minB.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4.6" width="10" height="0.8" fill="currentColor"/></svg>';
  const maxB = mk('dsh-wc-max', '最大化');
  const closeB = mk('dsh-wc-close', '关闭');
  closeB.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.6 0.6L9.4 9.4M9.4 0.6L0.6 9.4" stroke="currentColor" stroke-width="0.9" fill="none"/></svg>';
  const setMaxGlyph = (maximized) => {
    maxB.title = maximized ? '向下还原' : '最大化';
    maxB.innerHTML = maximized
      ? '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="2.6" width="6.8" height="6.8" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.8 2.6V0.4H9.6V7.4H7.4" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>'
      : '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>';
  };
  setMaxGlyph(initialMaximized);
  minB.addEventListener('click', () => window.dshWindow.minimize());
  maxB.addEventListener('click', () => window.dshWindow.toggleMaximize());
  closeB.addEventListener('click', () => window.dshWindow.close());
  window.dshWindow.onMaximizeChange(setMaxGlyph);
  strip.appendChild(minB);
  strip.appendChild(maxB);
  strip.appendChild(closeB);
  document.body.appendChild(strip);
}

function injectShellUI() {
  if (!win || win.isDestroyed()) return;
  const height = CONTROL_HEIGHT;
  const controlWidth = CONTROL_WIDTH;
  const dragHeight = DRAG_HEIGHT;
  const maximized = win.isMaximized();
  win.webContents.executeJavaScript(`(() => {
    document.getElementById('dsh-titlebar')?.remove();
    document.getElementById('dsh-shell-pad')?.remove();
    document.getElementById('dsh-drag-band')?.remove();
    const band = document.createElement('div');
    band.id = 'dsh-drag-band';
    band.style.cssText = 'position:fixed;top:0;left:0;right:${controlWidth}px;height:${dragHeight}px;' +
      'z-index:2147483646;-webkit-app-region:drag;';
    band.addEventListener('dblclick', () => { if (window.dshWindow) window.dshWindow.toggleMaximize(); });
    document.body.appendChild(band);
    document.getElementById('dsh-shell-css')?.remove();
    const css = document.createElement('style');
    css.id = 'dsh-shell-css';
    // 会话头 titleCluster 是 flex:1，会把 Session log 顶到最右。用结构选择器压掉
    // 增长，让 utilities 紧挨「标准模式」；!important 避免被 CSS module 盖掉。
    css.textContent =
      'button,input,textarea,select,a,[role="button"],[contenteditable="true"]{-webkit-app-region:no-drag}' +
      'header>div:first-of-type{justify-content:flex-start !important;}' +
      'header>div:first-of-type>div:first-of-type{flex:0 1 auto !important;min-width:0 !important;}' +
      'header>div:first-of-type>div:last-of-type{margin-left:12px !important;margin-right:0 !important;}';
    document.head.appendChild(css);
    (${installWindowControls.toString()})(${maximized},${height},${controlWidth});
  })()`).then(() => {
    if (!win || win.isDestroyed()) return;
    return win.webContents.executeJavaScript(SHELL_UPDATE_JS);
  }).catch(() => { /* 页面已卸载或尚未就绪 */ });
}

const LOADING_HTML = '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#ffffff;color:#4a4f57">' +
  '<div style="font-size:20px;font-weight:600">DeepSeek Harness</div>' +
  '<div style="margin-top:12px;font-size:13px;opacity:.75">正在启动服务…</div></body></html>';

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: cfg.icon,
    title: 'DeepSeek Harness',
    show: false, // 等首帧渲染完成再显示，避免白屏一闪
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    // 隐藏 OS 标题栏；右上角 最小化/最大化/关闭 由注入的自绘按钮承担（见 injectShellUI）。
    titleBarStyle: 'hidden',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  if (cfg.icon) win.setIcon(cfg.icon);
  win.once('ready-to-show', () => { if (win && !win.isDestroyed()) win.show(); });
  // 点 X 不销毁窗口，改为隐藏到托盘/任务栏；内容保留，恢复即秒显、不再白屏重载。
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  // 最大化状态推送给自绘按钮切换 还原/最大化 图标
  const sendMaximized = (v) => { if (win && !win.isDestroyed()) win.webContents.send('dsh-window:maximized', v); };
  win.on('maximize', () => sendMaximized(true));
  win.on('unmaximize', () => sendMaximized(false));
  win.webContents.on('did-finish-load', injectShellUI);
  // 网页想新开的链接交给系统浏览器，避免脱离托盘管理的裸 Electron 窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
}

let sessionUrl = cfg.url;

function ensureNav() { if (win && !win.isDestroyed()) win.loadURL(sessionUrl); }

const BOOT_RETRIES = 3;
const BOOT_RETRY_DELAY_MS = 10000;
const MAX_CRASH_RESTARTS = 5;
const CRASH_RESTART_DELAY_MS = 3000;
let crashRestarts = 0;

/** spawn 前预检：端口被别的程序占用时立刻报真实原因，而不是误判成就绪或白等 90s。 */
async function assertPortFree(port) {
  const busy = await waitForPort(port, { timeoutMs: 1000 }).then(() => true, () => false);
  if (busy) throw new Error(`端口 ${port} 已被其他程序占用，请关闭占用进程，或在 config.json 中更换 port`);
}

/** 给 server 打主动停止标记：watchServer 凭它区分「主动 stop」与「意外退出」。 */
function markManualStop(s) {
  s.stoppedByUser = false;
  const origStop = s.stop.bind(s);
  s.stop = async () => { s.stoppedByUser = true; await origStop(); };
}

async function bootServer(attempt = 1) {
  try {
    await assertPortFree(cfg.port);
    let announced = '';
    let resolveUrl;
    const urlReady = new Promise((resolve) => { resolveUrl = resolve; });
    server = startServer(cfg, (line) => {
      announced += line;
      log('server: ' + line.trimEnd());
      const authed = parseDshWebUrl(announced, cfg);
      if (authed) resolveUrl(authed);
    });
    markManualStop(server);
    await server.ready;
    let urlTimer;
    const authed = await Promise.race([
      urlReady,
      new Promise((_, reject) => {
        urlTimer = setTimeout(() => reject(new Error('服务器未在超时内打印认证 URL（dsh web: http://host:port/?token=…）')), 15000);
      }),
    ]).finally(() => clearTimeout(urlTimer));
    sessionUrl = authed;
    log('server ready, navigating to authenticated URL');
    ensureNav();
    watchServer(server);
  } catch (e) {
    log('server failed: ' + e.message);
    if (quitting) return;
    if (attempt < BOOT_RETRIES) {
      log(`retrying boot (${attempt + 1}/${BOOT_RETRIES}) in ${BOOT_RETRY_DELAY_MS / 1000}s`);
      setTimeout(() => { if (!quitting) bootServer(attempt + 1); }, BOOT_RETRY_DELAY_MS);
    } else {
      dialog.showErrorBox('DeepSeek Harness 启动失败', e.message);
    }
  }
}

/** 服务就绪后看护：意外退出（排除主动 stop/退出中）→ 自动重启，次数超限则停手报错。 */
function watchServer(s) {
  s.child.once('exit', (code, sig) => {
    if (quitting || s.stoppedByUser) return;
    crashRestarts += 1;
    log(`server exited unexpectedly (code=${code}, sig=${sig})`);
    if (crashRestarts > MAX_CRASH_RESTARTS) {
      dialog.showErrorBox('DeepSeek Harness', '服务多次意外退出，已停止自动重启。请查看 app.log 排查。');
      return;
    }
    new Notification({ title: 'DeepSeek Harness', body: `服务意外退出，自动重启中（${crashRestarts}/${MAX_CRASH_RESTARTS}）…` }).show();
    setTimeout(() => { if (!quitting) bootServer(); }, CRASH_RESTART_DELAY_MS);
  });
}

/** 手动重启：停掉旧服务重新拉起，并清零崩溃重启计数。 */
async function restartServer() {
  crashRestarts = 0;
  if (server) { try { await server.stop(); } catch { /* ignore */ } }
  await bootServer();
}

function showMainWindow() {
  if (!win || win.isDestroyed()) { createWindow(); return; }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** 全局快捷键动作：显示/隐藏切换。 */
function toggleMainWindow() {
  if (win && win.isVisible() && !win.isMinimized()) win.hide();
  else showMainWindow();
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(cfg.icon));
  tray.setToolTip('DeepSeek Harness');
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => { if (win && win.isVisible()) win.hide(); else showMainWindow(); } },
    { label: '重启服务器', click: () => { restartServer(); } },
    { label: '在浏览器打开', click: () => { if (/^https?:/i.test(sessionUrl)) shell.openExternal(sessionUrl); } },
    { label: '打开日志', click: () => { shell.openPath(LOG); } },
    { label: '检查更新', click: () => runUpdateCheck(true) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (win && win.isVisible()) win.hide(); else showMainWindow(); });
}

/** 托盘 tooltip 带上外层仓库当前 HEAD，更新有没有生效一眼可见。 */
async function refreshTrayTooltip() {
  try {
    const sha = await headSha(cfg);
    if (tray && !tray.isDestroyed()) tray.setToolTip('DeepSeek Harness' + (sha ? `\nrepo: ${short(sha)}` : ''));
  } catch { /* tooltip 缺版本号不是致命问题 */ }
}

let updateBusy = false;
let updateState = { status: 'idle', localSha: null, remoteSha: null, step: '', log: '', error: '' };

function pushUpdateState() {
  if (win && !win.isDestroyed()) win.webContents.send('dsh-update:state', updateState);
}

function setUpdateState(patch) {
  updateState = { ...updateState, ...patch };
  pushUpdateState();
}

function appendUpdateLog(line) {
  const prev = updateState.log ? updateState.log.split('\n') : [];
  prev.push(line);
  setUpdateState({ log: prev.slice(-80).join('\n'), step: line });
}

function dismissUpdate() {
  if (updateState.status === 'applying') return;
  if (updateState.status === 'failed' && updateState.remoteSha) {
    setUpdateState({ status: 'available', step: '', error: '' });
    return;
  }
  setUpdateState({ status: 'idle', step: '', log: '', error: '' });
}

async function applyAvailableUpdate() {
  if (updateBusy) return { ok: false, reason: 'busy' };
  if (!updater) updater = makeUpdater(cfg);
  updateBusy = true;
  setUpdateState({ status: 'applying', step: '开始更新…', log: '', error: '' });
  try {
    log('apply update start');
    const r = await updater.applyUpdate((line) => {
      log('update: ' + line);
      appendUpdateLog(line);
    }).catch((e) => ({ ok: false, reason: e.message, at: 'applyUpdate' }));
    if (r.ok) {
      log('update done to ' + r.sha);
      setUpdateState({ status: 'idle', localSha: r.sha, remoteSha: r.sha, step: '', log: '', error: '' });
      new Notification({ title: '更新完成', body: '已更新到 ' + short(r.sha) + '，正在重启服务…' }).show();
      if (server) { try { await server.stop(); } catch { /* ignore */ } }
      await bootServer();
      refreshTrayTooltip();
      return { ok: true, sha: r.sha };
    }
    const err = (r.reason || '未知原因') + (r.at ? ' [' + r.at + ']' : '');
    log('update failed: ' + err);
    setUpdateState({ status: 'failed', error: err });
    return { ok: false, reason: err };
  } finally {
    updateBusy = false;
  }
}

async function runUpdateCheck(manual = false) {
  // 检查与更新链不可重入：自动定时、启动首查、托盘手动可能重叠，并发跑 git/pnpm 会互相踩。
  if (updateBusy || updateState.status === 'applying') {
    if (manual) new Notification({ title: '检查更新', body: '已有检查/更新在进行中，请稍候' }).show();
    return;
  }
  updateBusy = true;
  try {
    if (!updater) updater = makeUpdater(cfg);
    let info;
    try { info = await updater.checkForUpdate(); } catch (e) { log('update check error: ' + e.message); return; }
    if (!info.reachable) {
      if (manual) new Notification({ title: '检查更新', body: '无法连接 github.com，稍后再试' }).show();
      return;
    }
    if (info.diverged) {
      log('local history diverged from upstream, skipping');
      if (manual) new Notification({ title: '检查更新', body: '本地与上游无法快进，需在仓库手动处理' }).show();
      return;
    }
    if (!info.ahead) {
      setUpdateState({ status: 'idle', localSha: info.localSha, remoteSha: info.remoteSha, step: '', log: '', error: '' });
      if (manual) new Notification({ title: '检查更新', body: '已是最新版本 ' + short(info.localSha) }).show();
      return;
    }
    const already = updateState.status === 'available' && updateState.remoteSha === info.remoteSha;
    setUpdateState({ status: 'available', localSha: info.localSha, remoteSha: info.remoteSha, step: '', log: '', error: '' });
    if (!already) {
      new Notification({ title: '发现新版本', body: `${short(info.localSha)} → ${short(info.remoteSha)}，点击设置旁的「更新」` }).show();
    }
  } finally {
    updateBusy = false;
  }
}

/** 按配置维护登录自启项（openAtLogin:false 同样幂等清除）。 */
function applyAutoStart() {
  try {
    app.setLoginItemSettings({ openAtLogin: !!cfg.autoStart, path: process.execPath, args: [__dirname] });
  } catch (e) { log('设置开机自启失败: ' + e.message); }
}

/** 注册全局呼出/隐藏快捷键；冲突时跳过并记日志（依赖运行环境，不算配置错误）。 */
function registerHotkey() {
  if (!cfg.hotkey) return;
  const ok = globalShortcut.register(cfg.hotkey, toggleMainWindow);
  if (!ok) log(`全局快捷键 ${cfg.hotkey} 注册失败（可能被其他程序占用），已跳过`);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.whenReady().then(() => {
    createWindow();
    buildTray();
    refreshTrayTooltip();
    applyAutoStart();
    registerHotkey();
    bootServer();
    setTimeout(() => runUpdateCheck(false), 10000);
    setInterval(() => runUpdateCheck(false), cfg.checkIntervalMs);
  });
  // 关窗不退出：托盘常驻后台。
  app.on('window-all-closed', () => { /* noop */ });
  app.on('before-quit', async (e) => {
    if (!quitting) { e.preventDefault(); return; }
    if (server) { try { await server.stop(); log('server stopped'); } catch { /* ignore */ } }
  });
  app.on('will-quit', () => globalShortcut.unregisterAll());
}
