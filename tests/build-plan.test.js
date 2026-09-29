const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { selectDesktopBuildPlan, isDocsPath } = require('../build-plan.js');

test('构建步骤都在上游 package.json 里存在', (t) => {
  // 本仓库通常嵌套在上游检出内；在只检出 dsh-desktop 时跳过。
  const rootPkg = path.join(__dirname, '..', '..', 'package.json');
  if (!fs.existsSync(rootPkg)) return t.skip('未嵌套在上游检出内');
  const scripts = JSON.parse(fs.readFileSync(rootPkg, 'utf8')).scripts || {};
  const referenced = new Set();
  const probes = [
    [], ['README.md'], ['packages/core/agent/src/index.ts'], ['apps/web/src/index.tsx'],
    ['apps/desktop/src/main.ts'], ['native/system/entry/src/index.ts'], ['tooling/new-area/x.ts'],
  ];
  for (const probe of probes) for (const step of selectDesktopBuildPlan(probe).steps) referenced.add(step);
  for (const name of referenced) {
    assert.equal(typeof scripts[name], 'string', `pnpm run ${name} 在上游 package.json 中不存在`);
  }
});

test('isDocsPath: 文档、笔记、快照与许可证算文档', () => {
  for (const p of ['README.md', 'docs/testing.md', '.agents/notes/x.md', 'snapshots/a.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'packages/x/README.i18n.yaml']) {
    assert.equal(isDocsPath(p), true, p);
  }
  for (const p of ['apps/desktop/src/main.ts', 'packages/core/agent/src/index.ts', 'package.json']) {
    assert.equal(isDocsPath(p), false, p);
  }
});

test('selectDesktopBuildPlan: 无非文档变更时不构建', () => {
  const plan = selectDesktopBuildPlan([]);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.docsOnly, true);
});

test('selectDesktopBuildPlan: 仅文档变更时不构建', () => {
  const plan = selectDesktopBuildPlan(['README.md', 'docs/development.md', 'snapshots/expected.json']);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.docsOnly, true);
});

test('selectDesktopBuildPlan: 仅 apps/desktop 变更只重建桌面壳', () => {
  const plan = selectDesktopBuildPlan(['apps/desktop/src/main.ts']);
  assert.deepEqual(plan.steps, ['build:desktop']);
});

test('selectDesktopBuildPlan: 仅前端变更走 build:web', () => {
  const plan = selectDesktopBuildPlan(['apps/web/src/index.tsx']);
  assert.deepEqual(plan.steps, ['build:web']);
});

test('selectDesktopBuildPlan: client 包变更同时重建 lib 与 web', () => {
  const plan = selectDesktopBuildPlan(['packages/client/ui-sidebar/src/index.ts']);
  assert.deepEqual(plan.steps, ['build:lib', 'build:web']);
});

test('selectDesktopBuildPlan: 普通包变更走 build:lib', () => {
  const plan = selectDesktopBuildPlan(['packages/core/agent/src/index.ts']);
  assert.deepEqual(plan.steps, ['build:lib']);
});

test('selectDesktopBuildPlan: native 变更额外重建宿主 addon', () => {
  const plan = selectDesktopBuildPlan(['native/system/packages/entry/src/index.ts']);
  assert.deepEqual(plan.steps, ['build:native-system', 'build:lib']);
});

test('selectDesktopBuildPlan: 桌面壳与包同时变更时两者都建', () => {
  const plan = selectDesktopBuildPlan(['apps/desktop/src/main.ts', 'packages/core/agent/src/index.ts']);
  assert.deepEqual(plan.steps, ['build:lib', 'build:desktop']);
});

test('selectDesktopBuildPlan: 仓库元数据区域不触发构建', () => {
  const plan = selectDesktopBuildPlan(['.github/workflows/test.yml', 'website/index.ts', 'benchmarks/bench.ts']);
  assert.deepEqual(plan.steps, []);
  assert.equal(plan.docsOnly, true);
});

test('selectDesktopBuildPlan: 认不出的新区域回退完整构建', () => {
  const plan = selectDesktopBuildPlan(['tooling/new-area/file.ts']);
  assert.deepEqual(plan.steps, ['build']);
});

test('selectDesktopBuildPlan: 根配置文件触发 build:lib', () => {
  const plan = selectDesktopBuildPlan(['tsconfig.base.json']);
  assert.deepEqual(plan.steps, ['build:lib']);
});

test('selectDesktopBuildPlan: Windows 反斜杠路径同样识别', () => {
  const plan = selectDesktopBuildPlan(['apps\\desktop\\src\\main.ts']);
  assert.deepEqual(plan.steps, ['build:desktop']);
});
