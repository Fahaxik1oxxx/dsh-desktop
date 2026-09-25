// window-state.js — 主窗口几何状态的持久化与恢复校正（纯逻辑，可单测）。
// 保存 {x,y,width,height,maximized}；恢复时校验数值并把越界窗口拉回可见显示器，
// 避免显示器拔掉/分辨率变化后窗口开在屏幕外。
const fs = require('node:fs');

/** 窗口允许的最小尺寸。 */
const MIN_WIDTH = 420;
const MIN_HEIGHT = 300;

/**
 * 读取保存的窗口状态；文件缺失或内容损坏时返回 null（调用方用默认值）。
 * @param {string} file 状态文件路径
 * @returns {{x:number,y:number,width:number,height:number,maximized:boolean}|null}
 */
function loadWindowState(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const { x, y, width, height, maximized } = raw;
    for (const v of [x, y, width, height]) {
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    }
    return { x, y, width, height, maximized: maximized === true };
  } catch {
    return null;
  }
}

/** 原子化写出窗口状态；失败静默（状态丢失无害）。 */
function saveWindowState(file, state) {
  try {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch { /* 状态保存失败不影响使用 */ }
}

/**
 * 把窗口矩形与单个显示器求可见交集面积（交叠至少 80px×40px 才算「可见」，
 * 只压住一条边的窗口对用户毫无用处）。
 */
function visibleAreaOn(rect, display) {
  const x1 = Math.max(rect.x, display.x);
  const y1 = Math.max(rect.y, display.y);
  const x2 = Math.min(rect.x + rect.width, display.x + display.width);
  const y2 = Math.min(rect.y + rect.height, display.y + display.height);
  const w = x2 - x1;
  const h = y2 - y1;
  return (w >= 80 && h >= 40) ? w * h : 0;
}

/**
 * 校正保存的窗口状态：尺寸夹取到合法区间与最大显示器范围内；
 * 在任何显示器上都几乎不可见时丢弃位置（调用方让系统居中）。
 * @param {object} saved loadWindowState 的结果
 * @param {Array<{x:number,y:number,width:number,height:number}>} displays 当前所有显示器
 * @param {{width:number,height:number}} defaults 无状态时的默认尺寸
 * @returns {{x?:number,y?:number,width:number,height:number,maximized:boolean}}
 */
function restoreWindowState(saved, displays, defaults) {
  const maxW = Math.max(...displays.map((d) => d.width));
  const maxH = Math.max(...displays.map((d) => d.height));
  const width = Math.min(Math.max(saved?.width ?? defaults.width, MIN_WIDTH), maxW);
  const height = Math.min(Math.max(saved?.height ?? defaults.height, MIN_HEIGHT), maxH);
  const maximized = saved?.maximized === true;
  if (typeof saved?.x !== 'number' || typeof saved?.y !== 'number') {
    return { width, height, maximized };
  }
  const rect = { x: saved.x, y: saved.y, width, height };
  const visible = displays.some((d) => visibleAreaOn(rect, d) > 0);
  if (!visible) return { width, height, maximized };
  return { x: Math.round(rect.x), y: Math.round(rect.y), width, height, maximized };
}

module.exports = { loadWindowState, saveWindowState, restoreWindowState };
