const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadWindowState, saveWindowState, restoreWindowState } = require('../window-state.js');

/** 模拟一块 1920×1080 的主显示器。 */
const display = { x: 0, y: 0, width: 1920, height: 1080 };
const defaults = { width: 1280, height: 800 };

test('loadWindowState: 文件缺失返回 null', () => {
  assert.equal(loadWindowState(path.join(os.tmpdir(), 'dsh-ws-missing.json')), null);
});

test('loadWindowState: 内容损坏返回 null', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-')), 'state.json');
  fs.writeFileSync(file, '{not json');
  assert.equal(loadWindowState(file), null);
  fs.writeFileSync(file, '{"width":"big"}');
  assert.equal(loadWindowState(file), null);
});

test('saveWindowState + loadWindowState: 原样往返', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-ws-')), 'state.json');
  saveWindowState(file, { x: 10, y: 20, width: 800, height: 600, maximized: true });
  assert.deepEqual(loadWindowState(file), { x: 10, y: 20, width: 800, height: 600, maximized: true });
});

test('restoreWindowState: 无状态用默认尺寸，不给坐标', () => {
  const geom = restoreWindowState(null, [display], defaults);
  assert.deepEqual(geom, { width: 1280, height: 800, maximized: false });
});

test('restoreWindowState: 可见位置原样恢复', () => {
  const geom = restoreWindowState({ x: 100, y: 50, width: 900, height: 700, maximized: true }, [display], defaults);
  assert.deepEqual(geom, { x: 100, y: 50, width: 900, height: 700, maximized: true });
});

test('restoreWindowState: 窗口完全在屏幕外时丢弃坐标', () => {
  const geom = restoreWindowState({ x: 5000, y: 2000, width: 900, height: 700, maximized: false }, [display], defaults);
  assert.deepEqual(geom, { width: 900, height: 700, maximized: false });
});

test('restoreWindowState: 只压住屏幕一条边的窗口也丢弃坐标', () => {
  // x=1900：只有 20px 在屏内（<80px 阈值），用户看到的是几乎全在屏外的窗口
  const geom = restoreWindowState({ x: 1900, y: 100, width: 900, height: 700, maximized: false }, [display], defaults);
  assert.equal(geom.x, undefined);
});

test('restoreWindowState: 尺寸夹取到最小值与显示器范围', () => {
  const tiny = restoreWindowState({ x: 0, y: 0, width: 100, height: 50, maximized: false }, [display], defaults);
  assert.deepEqual({ width: tiny.width, height: tiny.height }, { width: 420, height: 300 });
  const huge = restoreWindowState({ x: 0, y: 0, width: 99999, height: 99999, maximized: false }, [display], defaults);
  assert.deepEqual({ width: huge.width, height: huge.height }, { width: 1920, height: 1080 });
});

test('restoreWindowState: 双显示器下副屏位置合法即保留', () => {
  const second = { x: 1920, y: 0, width: 1920, height: 1080 };
  const geom = restoreWindowState({ x: 2000, y: 100, width: 800, height: 600, maximized: false }, [display, second], defaults);
  assert.deepEqual(geom, { x: 2000, y: 100, width: 800, height: 600, maximized: false });
});

test('restoreWindowState: 拔掉副屏后，原副屏坐标回落到主屏可见区', () => {
  const geom = restoreWindowState({ x: 2100, y: 100, width: 800, height: 600, maximized: false }, [display], defaults);
  assert.equal(geom.x, undefined);
});
