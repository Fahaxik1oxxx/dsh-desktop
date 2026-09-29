// launch-plan.js — 判断能否跳过上游 dev.ts 的启动前准备，直接拉起 Electron。
//
// `pnpm run start:desktop` 每次都跑 dev.ts，它无条件做两件重活：
//   1. prepareDevelopmentProject：把约 1500 个依赖链接镜像进一次性项目；
//   2. preparePrimaryRuntime：完整冒烟（Python 导入 numpy/pandas、Office 文档往返
//      转换、pip check）。
// 准备结果落在磁盘上且跨启动有效，所以只要它仍然对应当前工作区，就能直接启动。
// 这里只做纯判断，便于单测；实际状态采集在 launch.js。

/**
 * 决定是否可以快速启动。
 *
 * 全部条件成立才走快速路径；任何一条不成立都回退到完整的 `start:desktop`，
 * 因为那次运行会重新生成这里校验的东西。
 *
 * @param {object} state 当前检出与上次完整准备的状态
 * @param {boolean} state.desktopArtifact `apps/desktop/lib/main.js` 存在
 * @param {boolean} state.hostArtifact `apps/desktop-host/lib/index.js` 存在
 * @param {boolean} state.primaryRuntime 目标平台的 primary-runtime 目录存在
 * @param {string|null} state.preparedRelease 一次性项目 `desktop-runtime.json` 里记录的桌面版本
 * @param {string} state.desktopRelease `apps/desktop/package.json` 的当前版本
 * @param {{head: string, lockMtimeMs: number}|null} state.marker 上次完整准备时记录的工作区状态
 * @param {string} state.head 当前 git HEAD
 * @param {number} state.lockMtimeMs 当前 pnpm-lock.yaml 的修改时间
 * @returns {{fast: boolean, reason: string}}
 */
function shouldFastLaunch(state) {
  if (!state.desktopArtifact) return { fast: false, reason: '缺少 apps/desktop/lib/main.js' };
  if (!state.hostArtifact) return { fast: false, reason: '缺少 apps/desktop-host/lib/index.js' };
  if (!state.primaryRuntime) return { fast: false, reason: '缺少随包运行时目录' };
  if (state.preparedRelease === null) return { fast: false, reason: '一次性项目尚未准备' };
  if (state.preparedRelease !== state.desktopRelease) {
    return { fast: false, reason: `一次性项目是 ${state.preparedRelease}，当前桌面是 ${state.desktopRelease}` };
  }
  if (state.marker === null) return { fast: false, reason: '还没有完整准备的记录' };
  if (state.marker.head !== state.head) {
    return { fast: false, reason: `源码已从 ${String(state.marker.head).slice(0, 8)} 更新` };
  }
  if (state.marker.lockMtimeMs !== state.lockMtimeMs) {
    return { fast: false, reason: '依赖锁已变化' };
  }
  return { fast: true, reason: '准备结果仍然有效' };
}

module.exports = { shouldFastLaunch };
