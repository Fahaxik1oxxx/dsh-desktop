// updater.js — 检测 upstream 新版本并在用户确认后执行 git 拉取+重建。
// 依赖注入：makeUpdater(cfg, deps)。deps 可覆盖 runGit/runBash，便于单测。
const path = require('node:path');
const { run } = require('./proc.js');
const { hasTrackedChanges, isBehind, lockfileChanged } = require('./gitup.js');
const { runUpdateChain, winToPosix } = require('./update-lib.js');

function defaultGitExe(cfg) {
  // Git Bash 同目录下的 git.exe（usr/bin/git.exe）
  return path.join(path.dirname(cfg.bashExe), 'git.exe');
}

function makeUpdater(cfg, deps = {}) {
  const gitExe = deps.gitExe || defaultGitExe(cfg);
  const repo = cfg.repo;
  // runGit: (args) -> {code,stdout,stderr}，真实调用走 git.exe
  const runGit = deps.runGit || ((args) => run(gitExe, args, { cwd: repo, timeoutMs: 900000 }));
  // runBash: (script, {timeoutMs}) -> {code,stdout,stderr}，真实调用经 bash -c，PATH 前置 node.exe 所在目录
  const runBash = deps.runBash || ((script, { timeoutMs = 1800000 } = {}) =>
    run(cfg.bashExe, ['-c', `export PATH="${winToPosix(path.dirname(cfg.nodeExe))}:$PATH"; ${script}`], { cwd: repo, timeoutMs }));

  async function gitOut(args) {
    const r = await runGit(args);
    return r.stdout.trim();
  }

  /** fetch 远端并比对本地 HEAD。网络失败返回 reachable:false。 */
  async function checkForUpdate() {
    const f = await runBash(`git -C "${winToPosix(repo)}" fetch origin master 2>&1`, { timeoutMs: 240000 });
    if (f.code !== 0) return { reachable: false, ahead: false, localSha: null, remoteSha: null, error: (f.stderr || f.stdout).slice(0, 400) };
    const localSha = await gitOut(['rev-parse', 'HEAD']);
    const remoteSha = await gitOut(['rev-parse', 'FETCH_HEAD']);
    return { reachable: true, ahead: isBehind(localSha, remoteSha), localSha, remoteSha };
  }

  /**
   * 执行更新链：pre 取当前 sha → dirty 检查 → ff 检查 → pull --ff-only →
   * 若 lockfile 变化则 pnpm install → npm run build → 返回新 sha。
   * onProgress(line) 可选，接收每步输出尾部。
   */
  async function applyUpdate(onProgress = () => {}) {
    const state = {};
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
      { name: 'pull', fn: async () => {
          const p = await runGit(['pull', '--ff-only', 'origin', 'master']);
          onProgress((p.stdout || '').trim().split('\n').pop() || 'pull');
          return p.code === 0 ? { ok: true } : { ok: false, reason: 'git pull 失败：' + (p.stderr || p.stdout).slice(0, 400) };
      } },
      { name: 'install-if-needed', fn: async () => {
          // lockfileChanged 的 runFn 收带 'git' 前缀的参数；runGit 收不带前缀的，这里剥离。
          const runGitFromLock = (args) => runGit(args[0] === 'git' ? args.slice(1) : args);
          const changed = await lockfileChanged(repo, runGitFromLock, state.preSha, 'HEAD');
          if (!changed) { onProgress('依赖未变化，跳过 pnpm install'); return { ok: true }; }
          onProgress('依赖变化，运行 pnpm install …');
          const i = await runBash('cd "' + winToPosix(repo) + '" && corepack pnpm install --config.confirmModulesPurge=false 2>&1');
          onProgress((i.stdout || i.stderr || '').trim().split('\n').pop() || 'pnpm install');
          return i.code === 0 ? { ok: true } : { ok: false, reason: 'pnpm install 失败：' + (i.stderr || i.stdout).slice(0, 500) };
      } },
      { name: 'build', fn: async () => {
          onProgress('运行完整构建 npm run build …');
          const b = await runBash('cd "' + winToPosix(repo) + '" && npm run build 2>&1');
          const tail = (b.stdout || b.stderr || '').trim().split('\n').slice(-3).join('\n');
          onProgress(tail);
          return b.code === 0 ? { ok: true } : { ok: false, reason: '构建失败：\n' + tail.slice(0, 600) };
      } },
    ];
    const res = await runUpdateChain(steps);
    if (!res.ok) return { ok: false, reason: res.reason, at: res.at };
    const newSha = await gitOut(['rev-parse', 'HEAD']);
    return { ok: true, sha: newSha };
  }

  return { checkForUpdate, applyUpdate };
}

module.exports = { makeUpdater };
