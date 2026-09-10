const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chipSpec } = require('../update-ui.js');

test('chipSpec: idle 不显示芯片', () => {
  assert.equal(chipSpec({ status: 'idle' }), null);
});

test('chipSpec: 已是最新显示绿色文案', () => {
  const spec = chipSpec({ status: 'current', localSha: 'abcdef12ffff', step: '已是最新' });
  assert.equal(spec.text, '已是最新');
  assert.equal(spec.cls, 'ok');
  assert.match(spec.title, /abcdef12/);
  assert.equal(spec.action, null);
});

test('chipSpec: 有更新才可点击', () => {
  const spec = chipSpec({ status: 'available', localSha: 'aaaaaaaa', remoteSha: 'bbbbbbbb' });
  assert.equal(spec.text, '更新');
  assert.equal(spec.action, 'apply');
});

test('chipSpec: 检查中为禁用态', () => {
  const spec = chipSpec({ status: 'checking' });
  assert.equal(spec.text, '检查中…');
  assert.equal(spec.action, null);
});
