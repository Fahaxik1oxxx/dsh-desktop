const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shellLayoutCss } = require('../shell-layout.js');

test('shellLayoutCss: 给会话头打开侧边栏和右栏折叠按钮留出窗口控件宽度', () => {
  const css = shellLayoutCss(138);
  assert.match(css, /\[data-conversation-header-corner\]\{margin-right:118px !important;\}/);
  assert.match(css, /\[data-dockkit-strip-chrome\]\{margin-right:138px !important;\}/);
});
