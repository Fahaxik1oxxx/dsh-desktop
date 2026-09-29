// build-plan.js — 官方桌面需要哪些构建步骤，由变更文件决定。
//
// 官方桌面的完整构建是 `pnpm run build`（tsx scripts/build.ts），一次要跑
// tsc 全量 + tsdown 多面 + Web 前端，纯文档更新也照跑。这里把变更文件映射到
// 仓库已有的细粒度脚本，跳过与本次变更无关的阶段。

/** 只影响文档、笔记与快照期望的路径；它们不进入任何构建产物。 */
function isDocsPath(p) {
  return /\.(md|i18n\.yaml)$/i.test(p)
    || p.startsWith('docs/')
    || p.startsWith('.agents/')
    || p.startsWith('snapshots/')
    || p === 'LICENSE'
    || p === 'THIRD_PARTY_NOTICES.md';
}

/** 与桌面运行时产物无关的仓库区域：改了也不需要重建。 */
const NO_BUILD_PREFIXES = ['.github/', 'website/', 'benchmarks/', 'examples/', '.vscode/', '.claude/'];

/** 进入 Host 与包库产物的区域（build:lib）。 */
const LIB_PREFIXES = ['packages/', 'apps/cli/', 'apps/desktop-host/', 'vendor/', 'native/', 'scripts/'];

/** 归一化为仓库相对路径：反斜杠转正斜杠、去空白、丢弃空项。 */
function normalizePaths(changedPaths) {
  return changedPaths
    .map((p) => String(p).replace(/\\/g, '/').trim())
    .filter(Boolean);
}

function needsNoBuild(p) {
  return isDocsPath(p) || NO_BUILD_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** 认不出的新区域宁可全量重建，也不让桌面壳跑在半旧的产物上。 */
function selectSteps(code) {
  const any = (test) => code.some(test);
  const steps = [];
  if (any((p) => p === 'native' || p.startsWith('native/'))) steps.push('build:native-system');
  // 根目录配置文件（没有 `/`）同样影响 Host 产物。
  if (any((p) => !p.includes('/') || LIB_PREFIXES.some((prefix) => p.startsWith(prefix)))) steps.push('build:lib');
  if (any((p) => p.startsWith('apps/web/') || p.startsWith('packages/client/'))) steps.push('build:web');
  if (any((p) => p.startsWith('apps/desktop/'))) steps.push('build:desktop');
  return steps;
}

/**
 * 选择官方桌面的重建步骤。
 *
 * @param {string[]} changedPaths `git diff --name-only` 的路径列表
 * @returns {{steps: string[], reason: string, docsOnly: boolean}} steps 是 `pnpm run <name>` 的脚本名，按顺序执行
 */
function selectDesktopBuildPlan(changedPaths) {
  const names = normalizePaths(changedPaths);
  const code = names.filter((p) => !needsNoBuild(p));
  if (code.length === 0) {
    return { steps: [], reason: names.length === 0 ? '没有变更' : '仅文档/仓库元数据变更', docsOnly: true };
  }
  const steps = selectSteps(code);
  if (steps.length === 0) return { steps: ['build'], reason: '无法归类，回退完整构建', docsOnly: false };
  return { steps, reason: describe(names, steps), docsOnly: false };
}

/** 生成一行可读的原因说明。 */
function describe(names, steps) {
  const scope = names.length === 1 ? '1 个文件' : `${names.length} 个文件`;
  return `${scope}变更 → ${steps.join(' + ')}`;
}

module.exports = { selectDesktopBuildPlan, isDocsPath, normalizePaths };
