const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectBuildCommand } = require('../update-build.js');

test('selectBuildCommand: 空或仅文档不构建', () => {
  assert.equal(selectBuildCommand([]), null);
  assert.equal(selectBuildCommand(['README.md', 'docs/architecture.md', '.agents/notes/x.md']), null);
});

test('selectBuildCommand: 仅 web/client 走 build:web', () => {
  assert.equal(
    selectBuildCommand(['apps/web/src/main.ts', 'packages/client/ui-chat/src/index.ts']),
    'npm run build:web',
  );
});

test('selectBuildCommand: 普通代码走 lib+web', () => {
  assert.equal(
    selectBuildCommand(['packages/core/agent-loop/src/index.ts']),
    'npm run build:lib && npm run build:web',
  );
});

test('selectBuildCommand: native 走完整 npm run build', () => {
  assert.equal(selectBuildCommand(['native/system/src/lib.rs']), 'npm run build');
});
