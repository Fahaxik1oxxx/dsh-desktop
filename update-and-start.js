// update-and-start.js — 官方桌面（apps/desktop）的外置更新层。
//
// 官方桌面没有发布安装包，只能从源码启动；它自带的 updater 只服务打包版本，
// 因此源码检出怎么保持最新由这个脚本负责：
//   git fetch → 仅 fast-forward → 依赖变化才 install → 按变更增量构建 → 启动桌面
//
// 上游仓库保持干净（不修改任何上游文件），所以 git pull 永远是快进。
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { run } = require('./proc.js');
const { hasTrackedChanges, isBehind } = require('./gitup.js');
const { selectDesktopBuildPlan } = require('./build-plan.js');
const { preflight } = require('./preflight.js');

const REPO = path.resolve(__dirname, '..');
const REMOTE = 'origin';
const BRANCH = 'master';
const LOCKFILE = 'pnpm-lock.yaml';
const ARTIFACTS = [
  'apps/desktop/lib/main.js',
  'apps/desktop-host/lib/index.js',
];

function usage() {
  return [
    '用法: node update-and-start.js [选项]',
    '',
    '  --check        只报告本地/远端状态与将要执行的构建，不修改任何东西',
    '  --full         忽略增量判断，执行完整构建 pnpm run build',
    '  --no-build     只更新，不构建',
    '  --no-start     更新后不启动桌面',
    '  --git <path>   指定 git 可执行文件（默认 PATH 上的 git）',
    '  --help         显示本说明',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { check: false, full: false, noBuild: false, noStart: false, git: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--full') opts.full = true;
    else if (a === '--no-build') opts.noBuild = true;
    else if (a === '--no-start') opts.noStart = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--git') { i += 1; opts.git = argv[i] || null; }
    else throw new Error(`未知参数: ${a}\n\n${usage()}`);
  }
  return opts;
}

const log = (msg) => process.stdout.write(`[update] ${msg}\n`);
const warn = (msg) => process.stdout.write(`[update] 注意: ${msg}\n`);

/** 解析 git：显式参数 > 环境变量 > PATH 上的 git。 */
async function resolveGit(explicit) {
  const candidates = [explicit, process.env.DSH_DESKTOP_GIT, 'git'].filter(Boolean);
  for (const exe of candidates) {
    const r = await run(exe, ['--version'], { timeoutMs: 20000 });
    if (r.code === 0) return exe;
  }
  throw new Error('找不到可用的 git，请用 --git 指定 git.exe 的绝对路径');
}

/** 仓库内自带的 pnpm 优先，避免依赖 PATH 上的全局 pnpm。 */
function resolvePnpm() {
  const cjs = path.join(REPO, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (fs.existsSync(cjs)) return { exe: process.execPath, prefix: [cjs] };
  return { exe: 'pnpm', prefix: [] };
}

/** 缺产物时不能只靠“无变更”跳过构建，否则桌面壳会直接启动失败。 */
function missingArtifacts() {
  return ARTIFACTS.filter((p) => !fs.existsSync(path.join(REPO, p)));
}

function elapsed(t0) {
  const s = (Date.now() - t0) / 1000;
  return s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(1)}s`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(`${usage()}\n`); return 0; }

  const gitExe = await resolveGit(opts.git);
  const pnpm = resolvePnpm();
  const git = (args, extra = {}) => run(gitExe, args, { cwd: REPO, timeoutMs: 600000, ...extra });
  const gitOut = async (args) => (await git(args)).stdout.trim();
  const pnpmRun = (script, extra = {}) =>
    run(pnpm.exe, [...pnpm.prefix, 'run', script], { cwd: REPO, timeoutMs: 3600000, ...extra });

  log(`仓库 ${REPO}`);
  log(`git ${gitExe}`);

  // 1. 工作区必须是干净的，否则快进合并会覆盖或失败。
  const status = await git(['status', '--porcelain', '--untracked-files=no']);
  const dirty = hasTrackedChanges(status.stdout);
  if (dirty) warn('工作区有未提交改动，本次跳过更新（仅启动）');

  const preSha = await gitOut(['rev-parse', 'HEAD']);
  let targetSha = preSha;
  let reachable = true;
  let canUpdate = !dirty;

  if (!dirty) {
    const f = await git(['fetch', '--prune', '--no-tags', REMOTE, BRANCH]);
    if (f.code !== 0) {
      reachable = false;
      canUpdate = false;
      warn(`git fetch 失败，按离线处理: ${(f.stderr || f.stdout).trim().split('\n')[0]}`);
    } else {
      targetSha = await gitOut(['rev-parse', 'FETCH_HEAD']);
      if (!isBehind(preSha, targetSha)) {
        log(`已是最新 (${preSha.slice(0, 8)})`);
        canUpdate = false;
      } else {
        const ff = await git(['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD']);
        if (ff.code !== 0) {
          warn('本地与远端已分叉，无法 fast-forward，本次跳过更新（仅启动）');
          canUpdate = false;
        }
      }
    }
  }

  // 2. 统计将要执行的构建（--check 在这里停下）。
  const changed = canUpdate
    ? (await gitOut(['diff', '--name-only', preSha, targetSha])).split('\n').filter(Boolean)
    : [];
  const lockChanged = canUpdate
    ? (await gitOut(['diff', '--name-only', preSha, targetSha, '--', LOCKFILE])).length > 0
    : false;

  const missing = missingArtifacts();
  let plan;
  if (opts.full || missing.length > 0) {
    plan = {
      steps: ['build'],
      reason: opts.full ? '指定 --full' : `缺少构建产物 ${missing.join(', ')}`,
      docsOnly: false,
    };
  } else if (!canUpdate) {
    plan = { steps: [], reason: '无需更新', docsOnly: true };
  } else {
    plan = selectDesktopBuildPlan(changed);
  }
  if (opts.noBuild) plan = { ...plan, steps: [], reason: '指定 --no-build' };

  log(`本地 ${preSha.slice(0, 8)} → 远端 ${targetSha.slice(0, 8)}${reachable ? '' : ' (不可达)'}`);
  log(`构建计划: ${plan.steps.length === 0 ? '跳过' : plan.steps.join(' + ')} — ${plan.reason}`);
  if (lockChanged) log(`依赖锁变化: 需要 pnpm install`);

  if (opts.check) {
    log('--check 结束，未做任何修改');
    return 0;
  }

  // 3. 快进合并。
  if (canUpdate) {
    const t = Date.now();
    const m = await git(['merge', '--ff-only', 'FETCH_HEAD']);
    if (m.code !== 0) {
      warn(`git merge 失败: ${(m.stderr || m.stdout).trim().split('\n')[0]}`);
      warn('更新中止，继续用当前版本启动');
    } else {
      log(`已快进到 ${(await gitOut(['rev-parse', 'HEAD'])).slice(0, 8)} (${elapsed(t)})`);
    }
  }

  // 3.5 启动前修环境：清理 pnpm hoist 死链、盖章 Windows exe 图标。
  // 官方启动器遍历 hoist 目录时对每条链接 realpathSync，死链会让启动直接 ENOENT 失败。
  const fixed = preflight(REPO);
  if (fixed.pruned.length > 0) {
    log(`清理失效依赖链接 ${fixed.pruned.length} 个: ${fixed.pruned.map((p) => p.name).join(', ')}`);
  }
  log(`exe 图标: ${fixed.stamp.reason}`);

  // 4. 依赖：只有锁文件真的变了才装。
  if (canUpdate && lockChanged) {
    const t = Date.now();
    log('运行 pnpm install …');
    const r = await run(pnpm.exe, [...pnpm.prefix, 'install'], {
      cwd: REPO, timeoutMs: 3600000, onOut: (c) => process.stdout.write(c),
    });
    if (r.code !== 0) throw new Error(`pnpm install 失败 (exit ${r.code})`);
    log(`依赖就绪 (${elapsed(t)})`);
  }

  // 5. 增量构建。
  for (const script of plan.steps) {
    const t = Date.now();
    log(`运行 pnpm run ${script} …`);
    const r = await pnpmRun(script, { onOut: (c) => process.stdout.write(c) });
    if (r.code !== 0) throw new Error(`pnpm run ${script} 失败 (exit ${r.code})`);
    log(`${script} 完成 (${elapsed(t)})`);
  }

  // 6. 启动官方桌面。
  if (opts.noStart) { log('--no-start 结束'); return 0; }
  return launch(pnpm);
}

/** 以前台方式启动桌面壳，让它的日志留在当前控制台。 */
function launch(pnpm) {
  const home = process.env.DSH_HOME
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh');
  const env = {
    ...process.env,
    DSH_HOME: home,
    DSH_DESKTOP_OPEN_DEVTOOLS: process.env.DSH_DESKTOP_OPEN_DEVTOOLS || '0',
  };
  log(`启动官方桌面 (DSH_HOME=${home})`);
  const child = spawn(pnpm.exe, [...pnpm.prefix, 'run', 'start:desktop'], {
    cwd: REPO, env, stdio: 'inherit', windowsHide: false,
  });
  return new Promise((resolve) => {
    child.on('error', (e) => { warn(`启动失败: ${e.message}`); resolve(1); });
    child.on('close', (code) => resolve(code === null ? 1 : code));
  });
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((e) => {
    process.stderr.write(`[update] 失败: ${e.message}\n`);
    process.exitCode = 1;
  });
