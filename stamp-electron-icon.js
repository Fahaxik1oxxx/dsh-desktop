// stamp-electron-icon.js — 让官方桌面在 Windows 上用应用图标。
//
// 上游没有调用 app.setAppUserModelId，主窗口也没有显式 icon，所以任务栏与 Alt+Tab
// 的图标来自 Electron 可执行文件本身——未打包启动时就是 Electron 默认图标。
//
// 这里就地给 dist\electron.exe 盖图标与产品名，而不是复制改名成 DeepSeekHarness.exe：
// Electron 在 Windows 上按可执行文件名判断 app.isPackaged，一旦改名，官方桌面会把自己
// 当成已打包版本（development = !app.isPackaged 变为 false），转而去找
// apps/desktop/dsh/desktop-runtime.json 并在启动时 ENOENT 失败。
//
// 上游文件不动；只有 node_modules 下的 Electron 分发被就地盖章。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'apps', 'desktop');
const ICON = path.join(__dirname, 'assets', 'deepseek-official.ico');
const MARKER = '.dsh-icon-stamp.json';
const RENAMED_COPY = 'DeepSeekHarness.exe';

/** Electron 可能装在 apps/desktop 下也可能被提升到仓库根，取真的有 dist 的那个。 */
function electronPackageDir() {
  const candidates = [
    path.join(APP, 'node_modules', 'electron'),
    path.join(REPO, 'node_modules', 'electron'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'dist', 'electron.exe'))) return dir;
  }
  throw new Error('找不到 Electron 分发目录（先运行 pnpm install）');
}

function rceditExe() {
  const bin = path.join(__dirname, 'node_modules', 'rcedit', 'bin');
  for (const name of ['rcedit-x64.exe', 'rcedit.exe']) {
    const p = path.join(bin, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到 rcedit（desktop/node_modules/rcedit），无法盖章 exe');
}

function iconDigest() {
  return crypto.createHash('sha256').update(fs.readFileSync(ICON)).digest('hex');
}

/**
 * 就地给 Electron 可执行文件盖章，并保证 path.txt 指回 electron.exe。
 *
 * 幂等判断用标记文件里的图标摘要与盖章后的 exe 大小：重装依赖会把 electron.exe
 * 还原成原始字节，大小随之变化，于是下次启动会重新盖章。
 *
 * @param {{force?: boolean}} options force 为真时即使已是最新也重新盖章
 * @returns {{changed: boolean, exe: string, reason: string}}
 */
function stampElectronIcon(options = {}) {
  if (process.platform !== 'win32') {
    return { changed: false, exe: '', reason: '仅 Windows 需要盖章 exe' };
  }
  const pkgDir = electronPackageDir();
  const dist = path.join(pkgDir, 'dist');
  const exe = path.join(dist, 'electron.exe');
  const pathFile = path.join(pkgDir, 'path.txt');
  const markerFile = path.join(dist, MARKER);

  // 上一次实现留下的改名副本会让 app.isPackaged 变 true，清掉并让 path.txt 指回原名。
  const renamed = path.join(dist, RENAMED_COPY);
  let cleaned = false;
  if (fs.existsSync(renamed)) {
    try {
      fs.unlinkSync(renamed);
      cleaned = true;
    } catch { /* 正在运行或已删除，忽略 */ }
  }
  const current = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : '';
  if (current !== 'electron.exe') {
    fs.writeFileSync(pathFile, 'electron.exe');
    cleaned = true;
  }

  const digest = iconDigest();
  let marker = null;
  try {
    marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
  } catch { /* 没有标记或不可读，按未盖章处理 */ }
  const stamped = marker !== null
    && marker.iconDigest === digest
    && marker.exeSize === fs.statSync(exe).size;
  if (stamped && !options.force) {
    return { changed: cleaned, exe, reason: cleaned ? '清理改名副本并复原 path.txt' : '已是最新' };
  }

  const result = spawnSync(rceditExe(), [
    exe,
    '--set-icon', ICON,
    '--set-version-string', 'ProductName', 'DeepSeek Harness',
    '--set-version-string', 'FileDescription', 'DeepSeek Harness',
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`rcedit 盖章失败: ${(result.stderr || result.stdout || '').trim().slice(0, 300)}`);
  }
  fs.writeFileSync(markerFile, `${JSON.stringify({ iconDigest: digest, exeSize: fs.statSync(exe).size }, null, 2)}\n`);
  return { changed: true, exe, reason: '已盖章图标与产品名' };
}

if (require.main === module) {
  try {
    const r = stampElectronIcon({ force: process.argv.includes('--force') });
    process.stdout.write(`[stamp] ${r.reason}${r.exe ? ` → ${r.exe}` : ''}\n`);
  } catch (e) {
    process.stderr.write(`[stamp] 失败: ${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { stampElectronIcon };
