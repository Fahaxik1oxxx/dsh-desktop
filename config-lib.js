// config-lib.js — 读取并校验 config.json。文件边界上 fail loud：缺失、类型不符、
// 路径非法或不存在都直接抛错，不让未校验的值流向 spawn/网络。
const fs = require('node:fs');
const path = require('node:path');

/** 校验并返回配置对象；任何一项不满足即抛出带字段名的 Error。 */
function loadConfig(file) {
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of ['repo', 'nodeExe', 'bashExe', 'url']) {
    if (typeof cfg[k] !== 'string' || cfg[k].length === 0) {
      throw new Error(`config: ${k} 必须是非空字符串`);
    }
  }
  if (!Array.isArray(cfg.serverArgs) || cfg.serverArgs.some((a) => typeof a !== 'string' || a.length === 0)) {
    throw new Error('config: serverArgs 必须是非空字符串数组');
  }
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) {
    throw new Error('config: port 必须是 1-65535 的整数');
  }
  if (!Number.isInteger(cfg.checkIntervalMs) || cfg.checkIntervalMs < 1000) {
    throw new Error('config: checkIntervalMs 必须是 ≥1000 的整数毫秒');
  }
  // 可选字段：缺省用默认值，存在则校验类型
  if (cfg.autoStart !== undefined && typeof cfg.autoStart !== 'boolean') {
    throw new Error('config: autoStart 必须是布尔类型');
  }
  if (cfg.hotkey !== undefined && typeof cfg.hotkey !== 'string') {
    throw new Error('config: hotkey 必须是字符串类型（空字符串表示关闭）');
  }
  if (cfg.gitExe !== undefined && (typeof cfg.gitExe !== 'string' || cfg.gitExe.length === 0)) {
    throw new Error('config: gitExe 必须是非空字符串');
  }
  const configDir = path.dirname(path.resolve(file));
  if (cfg.icon === undefined || cfg.icon === '') {
    cfg.icon = path.join(configDir, 'assets', 'deepseek.ico');
  } else if (typeof cfg.icon !== 'string') {
    throw new Error('config: icon 必须是字符串类型');
  } else if (!path.isAbsolute(cfg.icon)) {
    cfg.icon = path.resolve(configDir, cfg.icon);
  }
  if (!fs.existsSync(cfg.repo) || !fs.statSync(cfg.repo).isDirectory()) {
    throw new Error(`config: repo 必须指向已存在的目录: ${cfg.repo}`);
  }
  for (const k of ['nodeExe', 'bashExe']) {
    if (!path.isAbsolute(cfg[k])) throw new Error(`config: ${k} 必须是绝对路径`);
    if (!fs.existsSync(cfg[k])) throw new Error(`config: ${k} 指向的文件不存在: ${cfg[k]}`);
  }
  return cfg;
}

module.exports = { loadConfig };
