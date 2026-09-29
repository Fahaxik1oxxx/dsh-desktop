const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldFastLaunch } = require('../launch-plan.js');

/** 一个全部就绪的状态；各用例只覆盖自己关心的字段。 */
function ready(overrides = {}) {
  return {
    desktopArtifact: true,
    hostArtifact: true,
    primaryRuntime: true,
    preparedRelease: '0.2.0-rc.2',
    desktopRelease: '0.2.0-rc.2',
    marker: { head: 'abc123', lockMtimeMs: 1000 },
    head: 'abc123',
    lockMtimeMs: 1000,
    ...overrides,
  };
}

test('shouldFastLaunch: 全部就绪时走快速路径', () => {
  const plan = shouldFastLaunch(ready());
  assert.equal(plan.fast, true);
});

test('shouldFastLaunch: 缺少构建产物时回退', () => {
  assert.equal(shouldFastLaunch(ready({ desktopArtifact: false })).fast, false);
  assert.equal(shouldFastLaunch(ready({ hostArtifact: false })).fast, false);
  assert.match(shouldFastLaunch(ready({ desktopArtifact: false })).reason, /main\.js/);
});

test('shouldFastLaunch: 缺少随包运行时回退', () => {
  assert.equal(shouldFastLaunch(ready({ primaryRuntime: false })).fast, false);
});

test('shouldFastLaunch: 一次性项目尚未准备时回退', () => {
  assert.equal(shouldFastLaunch(ready({ preparedRelease: null })).fast, false);
  assert.equal(shouldFastLaunch(ready({ marker: null })).fast, false);
});

test('shouldFastLaunch: 桌面版本与一次性项目不一致时回退', () => {
  const plan = shouldFastLaunch(ready({ preparedRelease: '0.1.7-rc.2' }));
  assert.equal(plan.fast, false);
  assert.match(plan.reason, /0\.1\.7-rc\.2/);
});

test('shouldFastLaunch: 源码更新后回退', () => {
  const plan = shouldFastLaunch(ready({ head: 'def456' }));
  assert.equal(plan.fast, false);
  assert.match(plan.reason, /源码已从 abc123 更新/);
});

test('shouldFastLaunch: 依赖锁变化后回退', () => {
  const plan = shouldFastLaunch(ready({ lockMtimeMs: 2000 }));
  assert.equal(plan.fast, false);
  assert.match(plan.reason, /依赖锁/);
});
