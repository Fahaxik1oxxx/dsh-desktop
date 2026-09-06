// preload.js — 经 contextBridge 向页面暴露窗口控制 API，供注入的自绘标题栏按钮调用。
// 渲染端不接触 node/ipcRenderer，只能调用这里列出的三个方法与一个订阅。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dshWindow', {
  minimize: () => ipcRenderer.invoke('dsh-window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('dsh-window:toggle-maximize'),
  close: () => ipcRenderer.invoke('dsh-window:close'),
  /** 订阅最大化状态变化；返回取消订阅函数。 */
  onMaximizeChange: (cb) => {
    const listener = (_e, maximized) => cb(maximized);
    ipcRenderer.on('dsh-window:maximized', listener);
    return () => ipcRenderer.removeListener('dsh-window:maximized', listener);
  },
});
