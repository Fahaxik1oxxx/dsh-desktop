// preload.js — 经 contextBridge 向页面暴露窗口控制与更新 API。
// 渲染端不接触 node/ipcRenderer。
const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('dshWindow', {
  minimize: () => ipcRenderer.invoke('dsh-window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('dsh-window:toggle-maximize'),
  close: () => ipcRenderer.invoke('dsh-window:close'),
  /** 订阅最大化状态变化；返回取消订阅函数。 */
  onMaximizeChange: (cb) => subscribe('dsh-window:maximized', cb),
});

contextBridge.exposeInMainWorld('dshUpdate', {
  getState: () => ipcRenderer.invoke('dsh-update:state'),
  apply: () => ipcRenderer.invoke('dsh-update:apply'),
  dismiss: () => ipcRenderer.invoke('dsh-update:dismiss'),
  onState: (cb) => subscribe('dsh-update:state', cb),
});
