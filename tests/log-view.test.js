const { test } = require('node:test');
const assert = require('node:assert/strict');
const { tailText } = require('../log-view.js');

test('tailText: 短日志原样返回', () => {
  assert.deepEqual(tailText('a\nb\n', 1000), { text: 'a\nb\n', truncated: false });
});

test('tailText: 超长时从完整行切开', () => {
  const content = 'keep-head\n' + 'x'.repeat(80) + '\nkeep-tail\n';
  const r = tailText(content, 20);
  assert.equal(r.truncated, true);
  assert.match(r.text, /keep-tail/);
  assert.doesNotMatch(r.text, /keep-head/);
});
