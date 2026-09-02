const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasTrackedChanges, lockfileChanged, ffPossible, isBehind } = require('../gitup.js');

test('hasTrackedChanges: 纯未跟踪文件不算改动', () => {
  assert.equal(hasTrackedChanges('?? a.log\n?? desktop/\n'), false);
});
test('hasTrackedChanges: tracked 修改返回 true', () => {
  assert.equal(hasTrackedChanges(' M src/x.js\n?? b.log\n'), true);
});
test('hasTrackedChanges: 空输出为 false', () => {
  assert.equal(hasTrackedChanges(''), false);
});

test('isBehind: 相同 sha 为 false', () => {
  assert.equal(isBehind('abc', 'abc'), false);
});
test('isBehind: 不同 sha 为 true', () => {
  assert.equal(isBehind('abc', 'def'), true);
});

test('lockfileChanged: diff 出 pnpm-lock 返回 true', async () => {
  const runFn = async () => ({ code: 0, stdout: 'pnpm-lock.yaml\n', stderr: '' });
  assert.equal(await lockfileChanged('/x', runFn, 'h', 'f'), true);
});
test('lockfileChanged: diff 为空返回 false', async () => {
  const runFn = async () => ({ code: 0, stdout: '', stderr: '' });
  assert.equal(await lockfileChanged('/x', runFn, 'h', 'f'), false);
});

test('ffPossible: git 退出码 0 为可快进', async () => {
  const runFn = async () => ({ code: 0, stdout: '', stderr: '' });
  assert.equal(await ffPossible('/x', runFn), true);
});
test('ffPossible: 退出码非 0 不可快进', async () => {
  const runFn = async () => ({ code: 1, stdout: '', stderr: 'not ancestor' });
  assert.equal(await ffPossible('/x', runFn), false);
});
