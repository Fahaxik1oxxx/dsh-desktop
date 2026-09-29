// preflight.js — 启动官方桌面之前的环境修复，两条启动路径共用。
//
// 两件事都是幂等的，且都不修改上游源码：
//   1. 清理 pnpm virtual-hoist 目录里指向已删包的死链。官方开发启动器会遍历该
//      目录并对每条链接 realpathSync，任何一条死链都会让启动直接 ENOENT 失败。
//   2. Windows 上就地给 Electron 可执行文件盖章，让任务栏/窗口用应用图标。
const path = require('node:path');
const { pruneRepoStaleLinks } = require('./link-audit.js');
const { stampElectronIcon } = require('./stamp-electron-icon.js');

const REPO = path.resolve(__dirname, '..');

/**
 * 修好启动官方桌面所需的环境。
 *
 * 死链清理失败会抛出：留下死链官方启动器必然 ENOENT，属于硬失败。盖章失败只降级
 * 为告警，因为正在运行的实例会锁住 exe，而标记未更新时下次启动会自动补盖。
 *
 * @param {string} [repo] 仓库根目录；默认本仓库的父目录
 * @returns {{pruned: Array<{name: string}>, stamp: {changed: boolean, reason: string}, stampError: string}}
 */
function preflight(repo = REPO) {
  const pruned = pruneRepoStaleLinks(repo);
  let stamp = { changed: false, reason: '', exe: '' };
  let stampError = '';
  try {
    stamp = stampElectronIcon();
  } catch (error) {
    stampError = error.message;
    stamp = { changed: false, reason: `跳过（${error.message}）`, exe: '' };
  }
  return { pruned, stamp, stampError };
}

if (require.main === module) {
  try {
    const { pruned, stamp, stampError } = preflight();
    if (pruned.length > 0) process.stdout.write(`[preflight] 清理失效依赖链接 ${pruned.length} 个\n`);
    process.stdout.write(`[preflight] exe 图标: ${stamp.reason}\n`);
    // 盖章失败不是启动阻塞：实例运行时 exe 被锁，下次启动会补盖。
    if (stampError !== '') process.stderr.write(`[preflight] exe 图标本次未更新，下次启动重试\n`);
  } catch (e) {
    process.stderr.write(`[preflight] 失败: ${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { preflight };
