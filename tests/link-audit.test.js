const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findStaleLinks, pruneStaleLinks, LINK_TYPE } = require('../link-audit.js');

/** 建一个临时 hoist 目录，返回 {root, projectDir, link}。 */
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-links-'));
  const root = path.join(base, 'node_modules', '.pnpm', 'node_modules');
  fs.mkdirSync(root, { recursive: true });
  return { base, root };
}

/** 写一个带 package.json 的包目录，返回其路径。 */
function makePackage(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
  return dir;
}

function link(target, linkPath) {
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(target, linkPath, LINK_TYPE);
}

test('findStaleLinks: 指向存在包目录的链接不算失效', () => {
  const { base, root } = fixture();
  const pkg = makePackage(path.join(base, 'store', 'good'), 'good');
  link(pkg, path.join(root, 'good'));
  assert.deepEqual(findStaleLinks(root), []);
});

test('findStaleLinks: 目标不存在算失效', () => {
  const { base, root } = fixture();
  link(path.join(base, 'store', 'gone'), path.join(root, 'gone'));
  const stale = findStaleLinks(root);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, 'gone');
  assert.equal(stale[0].reason, '目标不存在');
});

test('findStaleLinks: 作用域下的死链同样被认出', () => {
  const { base, root } = fixture();
  link(path.join(base, 'store', '@aws-crypto', 'crc32'), path.join(root, '@aws-crypto', 'crc32'));
  const stale = findStaleLinks(root);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, '@aws-crypto/crc32');
});

test('findStaleLinks: 目标存在但不是包目录算失效', () => {
  const { base, root } = fixture();
  const bare = path.join(base, 'store', 'bare');
  fs.mkdirSync(bare, { recursive: true });
  link(bare, path.join(root, 'bare'));
  const stale = findStaleLinks(root);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].reason, '目标不是包目录');
});

test('findStaleLinks: 包名与链接名不同的别名链接保留', () => {
  const { base, root } = fixture();
  const pkg = makePackage(path.join(base, 'store', 'string-width'), 'string-width');
  link(pkg, path.join(root, 'string-width-cjs'));
  assert.deepEqual(findStaleLinks(root), []);
});

test('findStaleLinks: 真实目录与常规文件都跳过', () => {
  const { root } = fixture();
  makePackage(path.join(root, 'real-dir'), 'real-dir');
  fs.writeFileSync(path.join(root, 'plain-file'), 'not a link');
  assert.deepEqual(findStaleLinks(root), []);
});

test('pruneStaleLinks: 只删失效链接，保留有效链接与真实目录', () => {
  const { base, root } = fixture();
  const good = makePackage(path.join(base, 'store', 'good'), 'good');
  link(good, path.join(root, 'good'));
  link(path.join(base, 'store', 'gone'), path.join(root, 'gone'));
  makePackage(path.join(root, 'real-dir'), 'real-dir');

  const removed = pruneStaleLinks(root);
  assert.deepEqual(removed.map((r) => r.name), ['gone']);
  assert.equal(fs.existsSync(path.join(root, 'good')), true);
  assert.equal(fs.existsSync(path.join(root, 'real-dir')), true);
  assert.equal(fs.existsSync(path.join(root, 'gone')), false);
  assert.deepEqual(findStaleLinks(root), []);
});

test('findStaleLinks: hoist 目录不存在时返回空', () => {
  assert.deepEqual(findStaleLinks(path.join(os.tmpdir(), 'dsh-links-missing', 'nope')), []);
});
