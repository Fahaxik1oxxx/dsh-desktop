// launch.js — 启动官方桌面：已就绪就直接拉起 Electron，否则回退到完整启动。
//
// 完整路径 `pnpm run start:desktop` 每次都跑 dev.ts 的镜像与冒烟（见 launch-plan.js），
// 冷启动约 100 秒。准备结果跨启动有效，所以这里先判断能否跳过，把日常启动压到几秒。
// 上游文件与上游启动器都保持原样，回退路径始终可用。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { run } = require('./proc.js');
const { shouldFastLaunch } = require('./launch-plan.js');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'apps', 'desktop');
const DEVELOPMENT_ROOT = path.join(APP, '.desktop-build', 'development');
const PROJECT = path.join(DEVELOPMENT_ROOT, 'project');
const MARKER = path.join(DEVELOPMENT_ROOT, '.dsh-layer-prepared.json');

/** 仓库内自带的 pnpm 优先，与 update-and-start.js 一致。 */
function resolvePnpm() {
  const cjs = path.join(REPO, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (fs.existsSync(cjs)) return { exe: process.execPath, prefix: [cjs] };
  return { exe: 'pnpm', prefix: [] };
}

/** 目标平台的 primary-runtime 目录：优先环境变量，否则用上游自己的解析规则。 */
async function primaryRuntimeDirectory() {
  if (process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR) return process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR;
  const mod = await import(pathToFileURL(path.join(APP, 'scripts', 'desktop-build-paths.mjs')).href);
  return mod.developmentRuntimeDirectory();
}

function readPreparedRelease() {
  try {
    const text = fs.readFileSync(path.join(PROJECT, 'desktop-runtime.json'), 'utf8');
    const release = JSON.parse(text).release;
    return typeof release?.version === 'string' ? release.version : null;
  } catch {
    return null; // 文件缺失或不可解析都表示一次性项目还没准备好
  }
}

function readDesktopRelease() {
  return JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
}

function readMarker() {
  try {
    const marker = JSON.parse(fs.readFileSync(MARKER, 'utf8'));
    if (typeof marker.head === 'string' && typeof marker.lockMtimeMs === 'number') return marker;
  } catch { /* 没有记录 */ }
  return null;
}

function lockMtimeMs() {
  try {
    return fs.statSync(path.join(REPO, 'pnpm-lock.yaml')).mtimeMs;
  } catch {
    return 0;
  }
}

/** 采集判断所需的全部状态。git 不可用时 HEAD 记为空串，快速路径会因此回退。 */
async function gatherState(primaryRuntime) {
  let head = '';
  try {
    const r = await run('git', ['rev-parse', 'HEAD'], { cwd: REPO, timeoutMs: 20000 });
    if (r.code === 0) head = r.stdout.trim();
  } catch { /* 没有 git 就走完整路径 */ }
  return {
    desktopArtifact: fs.existsSync(path.join(APP, 'lib', 'main.js')),
    hostArtifact: fs.existsSync(path.join(REPO, 'apps', 'desktop-host', 'lib', 'index.js')),
    primaryRuntime: fs.existsSync(primaryRuntime),
    preparedRelease: readPreparedRelease(),
    desktopRelease: readDesktopRelease(),
    marker: readMarker(),
    head,
    lockMtimeMs: lockMtimeMs(),
  };
}

function electronExecutable() {
  return createRequire(path.join(APP, 'package.json'))('electron');
}

/**
 * 桌面进程的环境。
 *
 * 必须清掉 `ELECTRON_RUN_AS_NODE`：它是宿主环境可能带上的（DSH 自己的 Electron
 * 子进程会设置它），一旦被继承，Electron 会按纯 Node 启动，对
 * `--remote-debugging-port` / `--user-data-dir` 直接报 `bad option` 并退出。
 * 上游 dev.ts 只展开 process.env，没有这一步。
 */
function desktopEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/** 按 dev.ts 的方式设置环境，然后以前台方式启动 Electron。 */
function spawnElectron(primaryRuntime, electronPorts) {
  const home = process.env.DSH_HOME
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const userData = process.env.DSH_DESKTOP_USER_DATA_DIR
    || path.join(DEVELOPMENT_ROOT, 'electron-user-data');
  const env = desktopEnv({
    DSH_HOME: home,
    DSH_DESKTOP_PRIMARY_RUNTIME_DIR: primaryRuntime,
    DSH_DESKTOP_HOST_INSPECT_PORT: process.env.DSH_DESKTOP_HOST_INSPECT_PORT || String(electronPorts.host),
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS || '1',
    ELECTRON_ENABLE_LOGGING: process.env.ELECTRON_ENABLE_LOGGING || '1',
  });
  const child = spawn(electronExecutable(), [
    `--inspect=127.0.0.1:${String(electronPorts.main)}`,
    `--remote-debugging-port=${String(electronPorts.renderer)}`,
    `--user-data-dir=${userData}`,
    APP,
  ], { cwd: APP, env, stdio: 'inherit', windowsHide: false });
  return child;
}

function portFrom(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  return Number.isSafeInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

/** 把工作区状态记为“已完整准备”。 */
function writeMarker(state) {
  fs.mkdirSync(DEVELOPMENT_ROOT, { recursive: true });
  fs.writeFileSync(MARKER, `${JSON.stringify({ head: state.head, lockMtimeMs: state.lockMtimeMs }, null, 2)}\n`);
}

/**
 * 把当前状态标记为已准备，使下一次启动直接走快速路径。
 *
 * 用于准备结果已经存在的情形：例如用户刚用上游 `pnpm run start:desktop` 起过一次，
 * 或这一层首次接管一个本来就能正常启动的检出。
 *
 * @returns {Promise<object>} 被记录的状态
 */
async function markPrepared() {
  const { state } = await planLaunch();
  writeMarker(state);
  return state;
}

/**
 * 采集状态并给出启动决策，不启动任何进程。
 *
 * @returns {Promise<{state: object, plan: {fast: boolean, reason: string}, primaryRuntime: string}>}
 */
async function planLaunch() {
  const primaryRuntime = await primaryRuntimeDirectory();
  const state = await gatherState(primaryRuntime);
  return { state, plan: shouldFastLaunch(state), primaryRuntime };
}

/**
 * 启动官方桌面。
 *
 * @param {(message: string) => void} [log] 进度输出
 * @param {(message: string) => void} [warn] 回退原因输出
 * @returns {Promise<number>} 进程退出码
 */
async function launchDesktop(log = () => {}, warn = () => {}) {
  const { plan, primaryRuntime, state } = await planLaunch();

  if (plan.fast) {
    log('准备结果有效，直接启动 Electron（跳过镜像与冒烟）');
    const child = spawnElectron(primaryRuntime, {
      main: portFrom('DSH_DESKTOP_MAIN_INSPECT_PORT', 9229),
      renderer: portFrom('DSH_DESKTOP_RENDERER_DEBUG_PORT', 9222),
      host: portFrom('DSH_DESKTOP_HOST_INSPECT_PORT', 9230),
    });
    return await new Promise((resolve) => {
      child.on('error', (error) => { warn(`直接启动失败: ${error.message}`); resolve(1); });
      child.on('close', (code) => resolve(code === null ? 1 : code));
    });
  }

  warn(`走完整启动（${plan.reason}）`);
  // 记录本次准备对应的工作区状态；下一次启动据此判断能否走快速路径。
  try {
    writeMarker(state);
  } catch (error) {
    warn(`无法记录准备状态: ${error.message}`);
  }
  const pnpm = resolvePnpm();
  const child = spawn(pnpm.exe, [...pnpm.prefix, 'run', 'start:desktop'], {
    cwd: REPO, env: desktopEnv(), stdio: 'inherit', windowsHide: false,
  });
  return await new Promise((resolve) => {
    child.on('error', (error) => { warn(`启动失败: ${error.message}`); resolve(1); });
    child.on('close', (code) => resolve(code === null ? 1 : code));
  });
}

module.exports = { launchDesktop, planLaunch, markPrepared, MARKER, PROJECT };
