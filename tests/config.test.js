const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../config-lib.js');

/** 写一个临时 config 文件并返回其路径；overrides 覆盖默认合法字段。 */
function writeConfig(overrides = {}) {
  const base = {
    repo: os.tmpdir(),
    nodeExe: process.execPath,
    bashExe: process.execPath,
    serverArgs: ['apps/cli/lib/bin.js', 'web'],
    port: 3080,
    url: 'http://127.0.0.1:3080',
    checkIntervalMs: 1800000,
  };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cfg-')), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ ...base, ...overrides }));
  return file;
}

test('loadConfig: 合法配置原样返回', () => {
  const cfg = loadConfig(writeConfig());
  assert.equal(cfg.port, 3080);
  assert.equal(cfg.checkIntervalMs, 1800000);
});

test('loadConfig: 文件不存在抛错', () => {
  assert.throws(() => loadConfig(path.join(os.tmpdir(), 'dsh-cfg-missing.json')), /ENOENT/);
});

test('loadConfig: 必填字段缺失或非字符串抛错', () => {
  for (const k of ['repo', 'nodeExe', 'bashExe', 'url']) {
    assert.throws(() => loadConfig(writeConfig({ [k]: 123 })), new RegExp(`config: ${k}`));
  }
});

test('loadConfig: 省略 icon 时解析为 config 旁的 assets/deepseek.ico', () => {
  const file = writeConfig();
  const cfg = loadConfig(file);
  assert.equal(cfg.icon, path.join(path.dirname(file), 'assets', 'deepseek.ico'));
});

test('loadConfig: 相对 icon 相对 config 文件解析', () => {
  const cfg = loadConfig(writeConfig({ icon: 'assets/deepseek.ico' }));
  assert.ok(path.isAbsolute(cfg.icon));
  assert.equal(path.basename(path.dirname(cfg.icon)), 'assets');
  assert.equal(path.basename(cfg.icon), 'deepseek.ico');
});

test('loadConfig: icon 非字符串抛错', () => {
  assert.throws(() => loadConfig(writeConfig({ icon: 123 })), /icon/);
});

test('loadConfig: nodeExe 相对路径抛错', () => {
  assert.throws(() => loadConfig(writeConfig({ nodeExe: 'node.exe' })), /nodeExe 必须是绝对路径/);
});

test('loadConfig: nodeExe 不存在抛错', () => {
  const missing = path.join(os.tmpdir(), 'dsh-cfg-nope.exe');
  assert.throws(() => loadConfig(writeConfig({ nodeExe: missing })), /不存在/);
});

test('loadConfig: repo 不是目录抛错', () => {
  assert.throws(() => loadConfig(writeConfig({ repo: process.execPath })), /repo 必须指向已存在的目录/);
});

test('loadConfig: serverArgs 必须是非空字符串数组', () => {
  assert.throws(() => loadConfig(writeConfig({ serverArgs: 'web' })), /serverArgs/);
  assert.throws(() => loadConfig(writeConfig({ serverArgs: ['a', ''] })), /serverArgs/);
});

test('loadConfig: port 与 checkIntervalMs 越界抛错', () => {
  assert.throws(() => loadConfig(writeConfig({ port: 0 })), /port/);
  assert.throws(() => loadConfig(writeConfig({ port: 70000 })), /port/);
  assert.throws(() => loadConfig(writeConfig({ checkIntervalMs: 500 })), /checkIntervalMs/);
});

test('config.example.json: 默认带 --no-open，避免启动时跳出系统浏览器', () => {
  const example = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'));
  assert.ok(example.serverArgs.includes('--no-open'));
});

test('loadConfig: autoStart/hotkey 可省略，存在则校验类型', () => {
  const cfg = loadConfig(writeConfig());
  assert.ok(!('autoStart' in cfg));
  assert.ok(!('hotkey' in cfg));
  assert.throws(() => loadConfig(writeConfig({ autoStart: 'yes' })), /autoStart/);
  assert.throws(() => loadConfig(writeConfig({ hotkey: 123 })), /hotkey/);
  assert.throws(() => loadConfig(writeConfig({ gitExe: 1 })), /gitExe/);
  const on = loadConfig(writeConfig({ autoStart: true, hotkey: '' }));
  assert.equal(on.autoStart, true);
  assert.equal(on.hotkey, '');
});
