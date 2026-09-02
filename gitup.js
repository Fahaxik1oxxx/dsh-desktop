// gitup.js — git 更新判定的纯逻辑。runFn 约定：(argsArray, repo) -> Promise<{code, stdout, stderr}>
const { run } = require('./proc.js');

/** porcelain 文本里，任一行（非空、不以 ?? 开头）即代表有 tracked 改动。 */
function hasTrackedChanges(porcelainText) {
  return porcelainText.split('\n').some((l) => l.trim() !== '' && !l.startsWith('??'));
}

/** 本地与远端 sha 不同即视为可能落后（能否 fast-forward 另查）。 */
function isBehind(localSha, remoteSha) {
  return localSha !== remoteSha;
}

/** 两个 ref 间 pnpm-lock.yaml 是否有差异。 */
async function lockfileChanged(repo, runFn, head, fetchHead) {
  const r = await runFn(['git', 'diff', '--name-only', head, fetchHead, '--', 'pnpm-lock.yaml'], repo);
  return r.code === 0 && r.stdout.trim().length > 0;
}

/** HEAD 是否可 fast-forward 到 FETCH_HEAD（merge-base --is-ancestor 退出码 0）。 */
async function ffPossible(repo, runFn) {
  const r = await runFn(['git', 'merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], repo);
  return r.code === 0;
}

/** 通用包装：把 (argsArray, repo) 映射为真实 git 调用（供非测试场景使用）。 */
async function gitRun(repo, argsArray) {
  return run('git', argsArray, { cwd: repo });
}

module.exports = { hasTrackedChanges, isBehind, lockfileChanged, ffPossible, gitRun };
