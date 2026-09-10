// update-build.js — 按变更文件选择最短可用的重建命令。
// 桌面壳不跑 native 完整构建，除非 native/ 自身有改动。

/**
 * @param {string[]} changedPaths git diff --name-only 的路径列表
 * @returns {string|null} 经 bash 执行的构建命令；无需重建时为 null
 */
function selectBuildCommand(changedPaths) {
  const names = changedPaths.map((p) => String(p).replace(/\\/g, '/').trim()).filter(Boolean);
  if (names.some((p) => p === 'native' || p.startsWith('native/'))) return 'npm run build';
  const code = names.filter((p) =>
    !/\.(md|i18n\.yaml)$/i.test(p)
    && !p.startsWith('docs/')
    && !p.startsWith('.agents/')
    && !p.startsWith('snapshots/')
    && p !== 'LICENSE'
    && p !== 'THIRD_PARTY_NOTICES.md'
  );
  if (code.length === 0) return null;
  const webOnly = code.every((p) =>
    p.startsWith('apps/web/') || p.startsWith('packages/client/')
  );
  if (webOnly) return 'npm run build:web';
  return 'npm run build:lib && npm run build:web';
}

module.exports = { selectBuildCommand };
