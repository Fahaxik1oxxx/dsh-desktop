// main.js — Electron 主进程：拉起 dsh 服务器、加载其 web UI、托盘常驻、检测并执行更新。
const { app, BrowserWindow, Tray, Menu, dialog, Notification, nativeImage, shell, globalShortcut, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer, waitForPort } = require('./server.js');
const { makeUpdater, headSha } = require('./updater.js');
const { loadConfig } = require('./config-lib.js');

const cfg = loadConfig(path.join(__dirname, 'config.json'));
// 自绘窗口控制按钮的 IPC（preload 经 contextBridge 暴露给页面，渲染端无 node 权限）
ipcMain.handle('dsh-window:minimize', () => { if (win && !win.isDestroyed()) win.minimize(); });
ipcMain.handle('dsh-window:toggle-maximize', () => {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('dsh-window:close', () => { if (win && !win.isDestroyed()) win.close(); }); // 走既有关窗到托盘逻辑

const LOG = path.join(__dirname, 'app.log');

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

// 自绘窗口控制按钮几何（对齐 ZCode/VS Code：46×36 透明按钮，融于页面背景）。
const DRAG_HEIGHT = 18; // 顶部可拖动窗口的透明条高度（避开下方应用可点区域）

/**
 * 注入到页面的自绘窗口控制按钮（对齐 ZCode/VS Code 式标题栏：按钮无底色、细线图标、
 * 完全融于页面背景；关闭键悬停红底白字）。本函数会被序列化后在渲染端执行，
 * 只能引用 DOM/window，不能引用主进程作用域。
 */
function installWindowControls(initialMaximized) {
  if (document.getElementById('dsh-win-controls') || !window.dshWindow) return;
  const strip = document.createElement('div');
  strip.id = 'dsh-win-controls';
  strip.style.cssText = 'position:fixed;top:0;right:0;width:138px;height:36px;z-index:2147483647;display:flex;-webkit-app-region:no-drag;color:#4a4f57;';
  const style = document.createElement('style');
  style.textContent =
    '.dsh-wc{flex:1 1 0;height:36px;border:0;padding:0;margin:0;background:transparent;color:inherit;' +
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
  win.webContents.executeJavaScript(`(() => {
    if (!document.getElementById('dsh-drag-band')) {
      const band = document.createElement('div');
      band.id = 'dsh-drag-band';
      band.style.cssText = 'position:fixed;top:0;left:0;right:0;height:${DRAG_HEIGHT}px;' +
        '-webkit-app-region:drag;z-index:2147483646;';
      band.addEventListener('dblclick', () => { if (window.dshWindow) window.dshWindow.toggleMaximize(); });
      document.body.appendChild(band);
    }
    const css = document.createElement('style');
    css.textContent = 'button,input,textarea,select,a,[role="button"],[contenteditable="true"]{-webkit-app-region:no-drag}';
    document.head.appendChild(css);
  })()`);
  win.webContents.executeJavaScript('(' + installWindowControls.toString() + ')(' + win.isMaximized() + ');');
}

const LOADING_HTML = '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;margin:0;background:#ffffff;color:#4a4f57">' +
  '<div style="font-size:20px;font-weight:600">DeepSeek Harness</div>' +
  '<div style="margin-top:12px;font-size:13px;opacity:.75">正在启动服务…</div></body></html>';

const PROGRESS_HTML = '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'body{margin:0;font:12px/1.6 Consolas,monospace;background:#1e1f22;color:#d6d9de;display:flex;flex-direction:column}' +
  'h4{margin:10px 14px 6px;font:600 13px system-ui,sans-serif;color:#fff}' +
  '#log{flex:1;margin:0 14px 12px;overflow:auto;white-space:pre-wrap;word-break:break-all}' +
  '</style></head><body><h4>更新中：git 拉取 + 完整重建，完成后界面自动恢复…</h4><pre id="log"></pre></body></html>';

let progressWin = null;

function ensureProgressWindow() {
  if (progressWin && !progressWin.isDestroyed()) return progressWin;
  progressWin = new BrowserWindow({
    width: 560,
    height: 220,
    show: false,
    autoHideMenuBar: true,
    maximizable: false,
    title: '更新中',
    webPreferences: { contextIsolation: true },
  });
  progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(PROGRESS_HTML));
  progressWin.once('ready-to-show', () => { if (progressWin && !progressWin.isDestroyed()) progressWin.show(); });
  progressWin.on('closed', () => { progressWin = null; });
  return progressWin;
}

function progressLine(text) {
  if (!progressWin || progressWin.isDestroyed()) return;
  // 文本以 JSON 字符串字面量注入，构建输出里的引号/反斜杠不会破坏脚本
  progressWin.webContents.executeJavaScript(
    `(() => { const el = document.getElementById('log'); el.textContent += ${JSON.stringify(String(text) + '\n')}; el.scrollTop = el.scrollHeight; })()`
  ).catch(() => { /* 窗口已被用户关闭，忽略 */ });
}

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

function ensureNav() { if (win && !win.isDestroyed()) win.loadURL(cfg.url); }

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
    server = startServer(cfg, (line) => log('server: ' + line.trimEnd()));
    markManualStop(server);
    await server.ready;
    log('server ready, navigating to ' + cfg.url);
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
    { label: '在浏览器打开', click: () => { shell.openExternal(cfg.url); } },
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

async function runUpdateCheck(manual = false) {
  // 检查与更新链不可重入：自动定时、启动首查、托盘手动可能重叠，并发跑 git/pnpm 会互相踩。
  if (updateBusy) {
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
      if (manual) new Notification({ title: '检查更新', body: '已是最新版本 ' + short(info.localSha) }).show();
      return;
    }
    new Notification({ title: '发现新版本', body: `${short(info.localSha)} → ${short(info.remoteSha)}` }).show();
    const choice = await dialog.showMessageBox({
      type: 'question',
      buttons: ['更新', '稍后'],
      defaultId: 0,
      cancelId: 1,
      message: '发现新版本',
      detail: `本地 ${short(info.localSha)}\n远端 ${short(info.remoteSha)}\n\n确认后将自动 git 拉取 + 重建并重启，界面可能短暂不可用。若工作区有未提交改动会中止更新。`,
    });
    if (choice.response !== 0) return;
    new Notification({ title: '正在更新', body: 'git 拉取 + 完整重建中，请稍候…' }).show();
    log('apply update start');
    ensureProgressWindow();
    const onProgress = (line) => {
      log('update: ' + line);
      for (const l of String(line).split('\n')) if (l.trim() !== '') progressLine(l);
    };
    const r = await updater.applyUpdate(onProgress).catch((e) => ({ ok: false, reason: e.message, at: 'applyUpdate' }));
    if (r.ok) {
      if (progressWin && !progressWin.isDestroyed()) progressWin.close();
      log('update done to ' + r.sha);
      new Notification({ title: '更新完成', body: '已更新到 ' + short(r.sha) + '，正在重启服务…' }).show();
      if (server) { try { await server.stop(); } catch { /* ignore */ } }
      await bootServer();
      refreshTrayTooltip();
    } else {
      // 失败时保留进度窗口，让用户能看到最后一段构建输出再关闭
      log('update failed: ' + (r.reason || '') + ' at ' + (r.at || '?'));
      dialog.showErrorBox('更新失败', (r.reason || '未知原因') + (r.at ? '\n[阶段：' + r.at + ']' : ''));
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
  app.setAppUserModelId('com.deepseek.dsh-desktop');
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
