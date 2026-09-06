const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDshWebUrl } = require('../web-url.js');

const expected = { url: 'http://127.0.0.1:3080', port: 3080 };

test('parseDshWebUrl: 取出带 token 的环回地址', () => {
  const href = parseDshWebUrl('dsh web: http://127.0.0.1:3080/?token=abc123', expected);
  assert.equal(href, 'http://127.0.0.1:3080/?token=abc123');
});

test('parseDshWebUrl: 忽略 LAN 后缀，只取第一段环回 URL', () => {
  const href = parseDshWebUrl(
    'dsh web: http://127.0.0.1:3080/?token=abc (LAN: http://192.168.1.2:3080/?token=abc)',
    expected,
  );
  assert.equal(href, 'http://127.0.0.1:3080/?token=abc');
});

test('parseDshWebUrl: 前缀日志行也能解析', () => {
  const href = parseDshWebUrl('server: dsh web: http://127.0.0.1:3080/?token=xyz\n', expected);
  assert.equal(href, 'http://127.0.0.1:3080/?token=xyz');
});

test('parseDshWebUrl: 拒绝其它主机或端口', () => {
  assert.equal(parseDshWebUrl('dsh web: http://192.168.1.2:3080/?token=abc', expected), null);
  assert.equal(parseDshWebUrl('dsh web: http://127.0.0.1:9999/?token=abc', expected), null);
  assert.equal(parseDshWebUrl('dsh web: http://example.com:3080/?token=abc', expected), null);
});

test('parseDshWebUrl: 拒绝非 http(s)、凭据、非根路径', () => {
  assert.equal(parseDshWebUrl('dsh web: ftp://127.0.0.1:3080/?token=abc', expected), null);
  assert.equal(parseDshWebUrl('dsh web: http://user:pass@127.0.0.1:3080/?token=abc', expected), null);
  assert.equal(parseDshWebUrl('dsh web: http://127.0.0.1:3080/evil?token=abc', expected), null);
});

test('parseDshWebUrl: 无关输出返回 null', () => {
  assert.equal(parseDshWebUrl('listening on 3080', expected), null);
});
