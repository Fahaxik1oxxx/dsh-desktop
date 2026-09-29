// preflight.js — 启动官方桌面之前的环境修复，两条启动路径共用。
//
// 两件事都是幂等的，且都不修改上游源码：
//   1. 清理 pnpm virtual-hoist 目录里指向已删包的死链。官方开发启动器会遍历该
//      目录并对每条链接 realpathSync，任何一条死链都会让启动直接 ENOENT 失败。
//   2. Windows 上复制并盖章 Electron 可执行文件，让任务栏/窗口用应用图标。
const path = require('node:path');
const { pruneRepoStaleLinks } = require('./link-audit.js');
const { stampElectronIcon } = require('./stamp-electron-icon.js');

const REPO = path.resolve(__dirname, '..');

/**
 * 修好启动官方桌面所需的环境。
 *
 * @param {string} [repo] 仓库根目录；默认本仓库的父目录
 * @returns {{pruned: Array<{name: string}>, stamp: {changed: boolean, reason: string}}}
 */
function preflight(repo = REPO) {
  const pruned = pruneRepoStaleLinks(repo);
  const stamp = stampElectronIcon();
  return { pruned, stamp };
}

if (require.main === module) {
  try {
    const { pruned, stamp } = preflight();
    if (pruned.length > 0) process.stdout.write(`[preflight] 清理失效依赖链接 ${pruned.length} 个\n`);
    process.stdout.write(`[preflight] exe 图标: ${stamp.reason}\n`);
  } catch (e) {
    process.stderr.write(`[preflight] 失败: ${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { preflight };
