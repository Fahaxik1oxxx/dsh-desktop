// link-audit.js — pnpm 的 virtual-hoist 目录会残留已删除包的链接。
//
// 官方桌面的开发启动器（apps/desktop/scripts/development-project.ts）会遍历
// node_modules/.pnpm/node_modules 并对每个链接 realpathSync，再读目标里的
// package.json；任何一条死链都会让启动直接 ENOENT 失败。pnpm 自己不会清理这些
// 残留（install、--force、删 .modules.yaml 都报 “Already up to date”），所以在
// 更新之后由这一层兜底。
const fs = require('node:fs');
const path = require('node:path');

/** Windows 用 junction（无需管理员权限），其它平台用目录符号链接。 */
const LINK_TYPE = process.platform === 'win32' ? 'junction' : 'dir';

/** 遍历一个 hoist 目录，产出 `{name, link}`；name 是作用域全名。 */
function eachHoistedLink(hoistRoot) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(hoistRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(hoistRoot, entry.name);
    if (entry.name.startsWith('@')) {
      let scoped;
      try {
        scoped = fs.readdirSync(full, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      for (const child of scoped) {
        out.push({ name: `${entry.name}/${child.name}`, link: path.join(full, child.name) });
      }
      continue;
    }
    out.push({ name: entry.name, link: full });
  }
  return out;
}

/**
 * 失效链接：目标是工作区/虚拟store里的绝对路径，但目标不存在，或目标不是包目录。
 *
 * 指向别名的链接（链接名与 package.json 的 name 不同，如 `string-width-cjs`）是
 * pnpm 的正常产物，因此这里不比较包名。
 *
 * @param {string} hoistRoot `node_modules/.pnpm/node_modules` 的绝对路径
 * @returns {Array<{name: string, link: string, target: string, reason: string}>}
 */
function findStaleLinks(hoistRoot) {
  const stale = [];
  for (const { name, link } of eachHoistedLink(hoistRoot)) {
    let stat;
    try {
      stat = fs.lstatSync(link);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isSymbolicLink()) continue;
    let target;
    try {
      target = fs.readlinkSync(link);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!path.isAbsolute(target)) continue;
    if (!fs.existsSync(target)) {
      stale.push({ name, link, target, reason: '目标不存在' });
      continue;
    }
    if (!fs.existsSync(path.join(target, 'package.json'))) {
      stale.push({ name, link, target, reason: '目标不是包目录' });
    }
  }
  return stale;
}

/**
 * 删除失效链接。
 *
 * @param {string} hoistRoot `node_modules/.pnpm/node_modules` 的绝对路径
 * @returns {Array<{name: string, link: string, target: string, reason: string}>} 被删除的条目
 */
function pruneStaleLinks(hoistRoot) {
  const removed = [];
  for (const entry of findStaleLinks(hoistRoot)) {
    try {
      fs.unlinkSync(entry.link);
      removed.push(entry);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return removed;
}

/**
 * 为一个仓库检出清理 hoist 残留。
 *
 * @param {string} repo 仓库根目录
 * @returns {Array<{name: string, link: string, target: string, reason: string}>}
 */
function pruneRepoStaleLinks(repo) {
  return pruneStaleLinks(path.join(repo, 'node_modules', '.pnpm', 'node_modules'));
}

module.exports = { findStaleLinks, pruneStaleLinks, pruneRepoStaleLinks, LINK_TYPE };
