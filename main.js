// main.js — Electron 主进程：拉起 dsh 服务器、加载其 web UI、托盘常驻、检测并执行更新。
const { app, BrowserWindow, Tray, Menu, dialog, Notification, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { startServer } = require('./server.js');
const { makeUpdater } = require('./updater.js');

const cfg = require('./config.json');
const LOG = path.join(__dirname, 'app.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try { fs.appendFileSync(LOG, line + '\n'); } catch { /* 忽略写日志失败 */ }
  // eslint-disable-next-line no-console
  console.log(line);
}
function short(s) { return (s || '').slice(0, 8); }

let win = null;
let tray = null;
let server = null;
let updater = null;
let quitting = false;

// Window Controls Overlay 参数（右上角系统按钮区域的背景色与拖拽条）。
const OVERLAY_HEIGHT = 36; // 与 titleBarOverlay.height 对应
const DRAG_HEIGHT = 18;    // 顶部可拖动窗口的透明条高度（避开下方应用可点区域）

function injectShellUI() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`(() => {
    if (document.getElementById('dsh-drag-band')) return;
    const band = document.createElement('div');
    band.id = 'dsh-drag-band';
    band.style.cssText = 'position:fixed;top:0;left:0;right:0;height:${DRAG_HEIGHT}px;' +
      '-webkit-app-region:drag;z-index:2147483646;';
    document.body.appendChild(band);
    const css = document.createElement('style');
    css.textContent = 'button,input,textarea,select,a,[role="button"],[contenteditable="true"]{-webkit-app-region:no-drag}';
    document.head.appendChild(css);
  })()`);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: cfg.icon,
    title: 'DeepSeek Harness',
    autoHideMenuBar: true,
    // 隐藏 OS 标题栏（去掉左上角标题/图标），由系统在右上角绘制原生 最小化/最大化/关闭。
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#ffffff', symbolColor: '#4a4f57', height: OVERLAY_HEIGHT },
    webPreferences: { contextIsolation: true },
  });
  win.on('closed', () => { win = null; }); // 关窗不退出，托盘常驻
  win.webContents.on('did-finish-load', injectShellUI);
  win.loadURL('data:text/html,<html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#1e1e1e;color:#eee">DeepSeek Harness 启动中…</body></html>');
}

function ensureNav() { if (win && !win.isDestroyed()) win.loadURL(cfg.url); }

async function bootServer() {
  server = startServer(cfg, (line) => log('server: ' + line.trimEnd()));
  try {
    await server.ready;
    log('server ready, navigating to ' + cfg.url);
    ensureNav();
  } catch (e) {
    log('server failed: ' + e.message);
    dialog.showErrorBox('DeepSeek Harness 启动失败', e.message);
  }
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(cfg.icon));
  tray.setToolTip('DeepSeek Harness');
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => { if (win) { win.isVisible() ? win.hide() : win.show(); } else createWindow(); } },
    { label: '检查更新', click: () => runUpdateCheck(true) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
}

async function runUpdateCheck(manual = false) {
  if (!updater) updater = makeUpdater(cfg);
  let info;
  try { info = await updater.checkForUpdate(); } catch (e) { log('update check error: ' + e.message); return; }
  if (!info.reachable) {
    if (manual) new Notification({ title: '检查更新', body: '无法连接 github.com，稍后再试' }).show();
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
  const r = await updater.applyUpdate((line) => log('update: ' + line));
  if (r.ok) {
    log('update done to ' + r.sha);
    new Notification({ title: '更新完成', body: '已更新到 ' + short(r.sha) + '，正在重启服务…' }).show();
    if (server) { try { await server.stop(); } catch { /* ignore */ } }
    await bootServer();
  } else {
    log('update failed: ' + (r.reason || '') + ' at ' + (r.at || '?'));
    dialog.showErrorBox('更新失败', (r.reason || '未知原因') + (r.at ? '\n[阶段：' + r.at + ']' : ''));
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.setAppUserModelId('com.deepseek.dsh-desktop');
  app.whenReady().then(() => {
    createWindow();
    buildTray();
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
}
