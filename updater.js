// updater.js — 检测 upstream 新版本并在用户确认后快进合并 + 按变更增量重建。
// 依赖注入：makeUpdater(cfg, deps)。deps 可覆盖 runGit/runBash，便于单测。
const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./proc.js');
const { hasTrackedChanges, isBehind, lockfileChanged, ffPossible } = require('./gitup.js');
const { runUpdateChain, winToPosix } = require('./update-lib.js');
const { selectBuildCommand } = require('./update-build.js');

/**
 * 解析 git.exe：优先显式 cfg.gitExe；否则从 bashExe 推导，按 Git for Windows 的
 * 各目录布局依次探测——新版安装的 usr\bin 里只有 bash.exe，git.exe 在 cmd 下。
 */
function defaultGitExe(cfg) {
  if (cfg.gitExe) return cfg.gitExe;
  const usrBin = path.dirname(cfg.bashExe);           // <Git根>\usr\bin
  const gitRoot = path.dirname(path.dirname(usrBin)); // <Git根>
  const candidates = [
    path.join(usrBin, 'git.exe'),
    path.join(gitRoot, 'cmd', 'git.exe'),
    path.join(gitRoot, 'bin', 'git.exe'),
    path.join(gitRoot, 'mingw64', 'bin', 'git.exe'),
  ];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) {
    throw new Error(`config: 无法从 bashExe 推导 git.exe，请在 config.json 增加 "gitExe" 字段（尝试过：${candidates.join('；')}）`);
  }
  return hit;
}

/**
 * 组装 runBash 的 bash 参数：PATH 前置 node 目录与 Git 的 usr\bin。
 * 非登录 bash 继承的只有 Windows PATH，corepack/npm 的 sh 脚本依赖的
 * sed/dirname/uname 都在 usr\bin，缺了它们 install/build 阶段必炸。
 */
function bashCommand(cfg, script) {
  const pathPre = `${winToPosix(path.dirname(cfg.nodeExe))}:${winToPosix(path.dirname(cfg.bashExe))}`;
  return ['-c', `export PATH="${pathPre}:$PATH"; ${script}`];
}

/** 把子进程块输出拆成行再交给 onProgress。 */
function linePump(onProgress) {
  let buf = '';
  return (chunk) => {
    buf += String(chunk);
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() || '';
    for (const line of parts) {
      const t = line.replace(/\r/g, '').trim();
      if (t) onProgress(t);
    }
  };
}

/**
 * 跑一条构建命令；失败则清产物后全量重建一次。跨大版本快进后 tsc 增量状态
 * （tsbuildinfo）可能指向已删除的导出，rolldown 报 Missing export，clean 可自愈。
 */
async function selfHealBuild(runBash, repo, cmd, onOut, onProgress) {
  const at = (script) => `cd "${winToPosix(repo)}" && ${script} 2>&1`;
  let b = await runBash(at(cmd), { onOut });
  if (b.code !== 0) {
    onProgress('构建失败，清理产物后全量重建 …');
    await runBash(at('corepack pnpm run clean'), { onOut });
    b = await runBash(at('npm run build'), { onOut });
  }
  return b;
}

function buildFailReason(b) {
  const tail = (b.stdout || b.stderr || '').trim().split('\n').slice(-3).join('\n');
  return '构建失败：\n' + tail.slice(0, 600);
}

function makeUpdater(cfg, deps = {}) {
  const repo = cfg.repo;
  // 惰性解析：注入 deps.runGit 的单测不触发文件探测，配置问题在首次真实调用时暴露
  const gitExe = () => deps.gitExe || defaultGitExe(cfg);
  // runGit: (args, opts?) -> {code,stdout,stderr}
  const runGit = deps.runGit || ((args, opts = {}) => run(gitExe(), args, { cwd: repo, timeoutMs: 900000, onOut: opts.onOut }));
  // runBash: (script, {timeoutMs, onOut}) -> {code,stdout,stderr}
  const runBash = deps.runBash || ((script, { timeoutMs = 1800000, onOut } = {}) =>
    run(cfg.bashExe, bashCommand(cfg, script), { cwd: repo, timeoutMs, onOut }));

  async function gitOut(args) {
    const r = await runGit(args);
    return r.stdout.trim();
  }

  const stripGit = (args) => (args[0] === 'git' ? args.slice(1) : args);

  /** fetch 远端并比对本地 HEAD。网络失败返回 reachable:false；无法快进时 diverged:true。 */
  async function checkForUpdate() {
    const f = await runGit(['fetch', '--prune', '--no-tags', 'origin', 'master']);
    if (f.code !== 0) return { reachable: false, ahead: false, diverged: false, localSha: null, remoteSha: null, error: (f.stderr || f.stdout).slice(0, 400) };
    const localSha = await gitOut(['rev-parse', 'HEAD']);
    const remoteSha = await gitOut(['rev-parse', 'FETCH_HEAD']);
    const ff = await ffPossible(repo, (args) => runGit(stripGit(args)));
    return { reachable: true, ahead: isBehind(localSha, remoteSha), diverged: !ff, localSha, remoteSha };
  }

  /**
   * 执行更新链：dirty 检查 → ff 检查 → merge --ff-only FETCH_HEAD →
   * 若 lockfile 变化则 pnpm install → 按变更文件选最短构建 → 返回新 sha。
   * 检测阶段已经 fetch 过，这里只做本地快进，避免再走一遍网络。
   * onProgress(line) 可选，接收每步输出。
   */
  async function applyUpdate(onProgress = () => {}) {
    const state = {};
    const onOut = linePump(onProgress);
    const steps = [
      { name: 'read-head', fn: async () => { state.preSha = await gitOut(['rev-parse', 'HEAD']); return { ok: true }; } },
      { name: 'dirty-check', fn: async () => {
          const s = await runGit(['status', '--porcelain', '--untracked-files=no']);
          return hasTrackedChanges(s.stdout)
            ? { ok: false, reason: '工作区有未提交改动，请先处理后再更新' }
            : { ok: true };
      } },
      { name: 'ff-check', fn: async () => {
          const ff = await runGit(['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD']);
          return ff.code === 0
            ? { ok: true }
            : { ok: false, reason: '本地与远端已分叉，无法 fast-forward，需手动处理' };
      } },
      { name: 'merge', fn: async () => {
          onProgress('快进合并 FETCH_HEAD …');
          const p = await runGit(['merge', '--ff-only', 'FETCH_HEAD'], { onOut });
          if (p.code !== 0) return { ok: false, reason: 'git merge 失败：' + (p.stderr || p.stdout).slice(0, 400) };
          return { ok: true };
      } },
      { name: 'install-if-needed', fn: async () => {
          const changed = await lockfileChanged(repo, (args) => runGit(stripGit(args)), state.preSha, 'HEAD');
          if (!changed) { onProgress('依赖未变化，跳过 pnpm install'); return { ok: true }; }
          state.installed = true; // 回滚凭据：只要动过 node_modules，回滚时就要恢复旧依赖
          onProgress('依赖变化，运行 pnpm install …');
          const i = await runBash('cd "' + winToPosix(repo) + '" && corepack pnpm install --config.confirmModulesPurge=false 2>&1', { onOut });
          return i.code === 0 ? { ok: true } : { ok: false, reason: 'pnpm install 失败：' + (i.stderr || i.stdout).slice(0, 500) };
      } },
      { name: 'build', fn: async () => {
          const diff = await runGit(['diff', '--name-only', state.preSha, 'HEAD']);
          const files = diff.code === 0 ? diff.stdout.split(/\r?\n/) : [];
          const cmd = selectBuildCommand(files);
          if (!cmd) { onProgress('无需重建前端/库，跳过构建'); return { ok: true }; }
          onProgress('运行 ' + cmd + ' …');
          const b = await selfHealBuild(runBash, repo, cmd, onOut, onProgress);
          return b.code === 0 ? { ok: true } : { ok: false, reason: buildFailReason(b) };
      } },
    ];
    const res = await runUpdateChain(steps);
    if (!res.ok) {
      // 保护机制：合并之后任何一步失败，都把仓库滚回更新前的 commit 并恢复到
      // 可运行的旧版本，绝不把应用留在打不开的状态。合并前失败无需回滚。
      const postMerge = res.at === 'install-if-needed' || res.at === 'build';
      if (postMerge) {
        onProgress('更新失败，回滚到更新前版本 …');
        const r = await runGit(['reset', '--hard', state.preSha], { onOut });
        if (r.code !== 0) {
          return { ok: false, reason: res.reason + '；且回滚失败：' + (r.stderr || r.stdout).slice(0, 200), at: res.at, rolledBack: false };
        }
        try {
          if (state.installed) {
            onProgress('恢复更新前依赖 …');
            const i = await runBash('cd "' + winToPosix(repo) + '" && corepack pnpm install --config.confirmModulesPurge=false 2>&1', { onOut });
            if (i.code !== 0) throw new Error('pnpm install 失败：' + (i.stderr || i.stdout).slice(0, 300));
          }
          // 只有构建阶段失败才需要重建旧版本（产物被新构建部分覆盖）；
          // install 失败时产物仍是旧版本的好状态，恢复依赖即可。
          if (res.at === 'build') {
            onProgress('重建更新前版本 …');
            const b = await selfHealBuild(runBash, repo, 'npm run build', onOut, onProgress);
            if (b.code !== 0) throw new Error(buildFailReason(b));
          }
          onProgress('已回滚到更新前版本 ' + state.preSha.slice(0, 8));
          return { ok: false, reason: res.reason, at: res.at, rolledBack: true };
        } catch (e) {
          return { ok: false, reason: res.reason + '；回滚后恢复旧版本失败：' + e.message, at: res.at, rolledBack: false };
        }
      }
      return { ok: false, reason: res.reason, at: res.at, rolledBack: false };
    }
    const newSha = await gitOut(['rev-parse', 'HEAD']);
    return { ok: true, sha: newSha };
  }

  return { checkForUpdate, applyUpdate };
}

/** 外层仓库当前 HEAD sha（本地操作，无网络）；失败返回空字符串。 */
async function headSha(cfg) {
  const r = await run(defaultGitExe(cfg), ['rev-parse', 'HEAD'], { cwd: cfg.repo, timeoutMs: 10000 });
  return r.code === 0 ? r.stdout.trim() : '';
}

/**
 * 启动自修复：服务器因产物残缺/依赖损坏无法组合时，装依赖 + 全量重建一次。
 * 与更新无关的独立恢复路径；成功后调用方重新拉起服务器即可。
 */
async function repairBuild(cfg, onProgress = () => {}) {
  const repo = cfg.repo;
  const onOut = linePump(onProgress);
  const runBash = (script) => run(cfg.bashExe, bashCommand(cfg, script), { cwd: repo, timeoutMs: 1800000, onOut });
  onProgress('自修复：安装依赖 …');
  const i = await runBash(`cd "${winToPosix(repo)}" && corepack pnpm install --config.confirmModulesPurge=false 2>&1`);
  if (i.code !== 0) throw new Error('pnpm install 失败：' + (i.stderr || i.stdout).slice(0, 500));
  const b = await selfHealBuild(runBash, repo, 'npm run build', onOut, onProgress);
  if (b.code !== 0) throw new Error(buildFailReason(b));
  return true;
}

module.exports = { makeUpdater, headSha, defaultGitExe, bashCommand, repairBuild };
