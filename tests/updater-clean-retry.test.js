const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeUpdater } = require('../updater.js');

function fakeGit(handlers) {
  return async (args) => {
    for (const [match, resp] of handlers) {
      if (args[0] === match || (Array.isArray(match) && match.every((x, i) => args[i] === x))) {
        if (typeof resp === 'function') return resp(args);
        return resp;
      }
    }
    return { code: 0, stdout: '', stderr: '' };
  };
}

/** diff 处理：带 '--'（lockfile 查询）返回空，其余返回变更文件清单。 */
function diffResponse(args) {
  return {
    code: 0,
    stdout: args.includes('--') ? '' : 'packages/client/ui-chat/src/a.ts\n',
    stderr: '',
  };
}

const BASE_GIT = [
  [['status', '--porcelain', '--untracked-files=no'], { code: 0, stdout: '', stderr: '' }],
  [['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
  [['merge', '--ff-only', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
  [['diff'], diffResponse],
];

test('applyUpdate: 构建失败后 clean 并全量重试一次，成功则正常完成', async () => {
  const scripts = [];
  let headCalls = 0;
  const runGit = fakeGit([
    ...BASE_GIT,
    [['rev-parse', 'HEAD'], () => ({ code: 0, stdout: (headCalls += 1) === 1 ? 'oldsha\n' : 'newsha\n', stderr: '' })],
  ]);
  const runBash = async (script) => {
    scripts.push(script);
    return { code: scripts.length === 1 ? 1 : 0, stdout: scripts.length === 1 ? 'Missing export\n' : 'built\n', stderr: '' };
  };
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit, runBash });
  const res = await u.applyUpdate();
  assert.equal(res.ok, true);
  assert.equal(res.sha, 'newsha');
  assert.equal(scripts.length, 3);
  assert.match(scripts[0], /npm run build:web/);
  assert.match(scripts[1], /pnpm run clean/);
  assert.match(scripts[2], /npm run build(?!:web)/);
});

test('保护机制：构建彻底失败时回滚到更新前 commit 并重建旧版本', async () => {
  const scripts = [];
  const gitArgs = [];
  const runGit = fakeGit([
    ...BASE_GIT,
    [['rev-parse', 'HEAD'], { code: 0, stdout: 'oldsha\n', stderr: '' }],
    [['reset', '--hard', 'oldsha'], () => ({ code: 0, stdout: '', stderr: '' })],
  ]);
  // 记录全部 git 参数以便断言 reset 被调用
  const wrapped = async (args) => { gitArgs.push(args); return runGit(args); };
  const runBash = async (script) => {
    scripts.push(script);
    // 新版本的构建（前 3 次：build:web、clean、build）失败；回滚后重建旧版本成功
    return { code: scripts.length <= 3 ? 1 : 0, stdout: scripts.length <= 3 ? 'Missing export\n' : 'built\n', stderr: '' };
  };
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit: wrapped, runBash });
  const res = await u.applyUpdate();
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  assert.equal(res.at, 'build');
  assert.ok(gitArgs.some((a) => a[0] === 'reset' && a[1] === '--hard' && a[2] === 'oldsha'));
  // 回滚后重建旧版本一次成功：build:web、clean、build（新版本失败）、再 build（旧版本成功）
  assert.equal(scripts.length, 4);
  assert.match(scripts[3], /npm run build(?!:web)/);
});

test('保护机制：install 失败时回滚并恢复旧依赖，不触发重建', async () => {
  const scripts = [];
  const gitArgs = [];
  const runGit = fakeGit([
    [['rev-parse', 'HEAD'], { code: 0, stdout: 'oldsha\n', stderr: '' }],
    [['status', '--porcelain', '--untracked-files=no'], { code: 0, stdout: '', stderr: '' }],
    [['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
    [['merge', '--ff-only', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
    [['diff', '--name-only', 'oldsha', 'HEAD'], { code: 0, stdout: 'packages/client/ui-chat/src/a.ts\npnpm-lock.yaml\n', stderr: '' }],
    [['reset', '--hard', 'oldsha'], () => ({ code: 0, stdout: '', stderr: '' })],
  ]);
  const wrapped = async (args) => { gitArgs.push(args); return runGit(args); };
  const runBash = async (script) => {
    scripts.push(script);
    // 第一次 install（新版本）失败；回滚中的第二次 install 成功
    return { code: scripts.length === 1 ? 1 : 0, stdout: '', stderr: scripts.length === 1 ? 'network down' : '' };
  };
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit: wrapped, runBash });
  const res = await u.applyUpdate();
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, true);
  assert.equal(res.at, 'install-if-needed');
  assert.ok(gitArgs.some((a) => a[0] === 'reset' && a[1] === '--hard' && a[2] === 'oldsha'));
  assert.equal(scripts.length, 2);
  assert.match(scripts[1], /pnpm install/);
});

test('保护机制：合并前失败（脏工作区）不回滚', async () => {
  const gitArgs = [];
  const runGit = fakeGit([
    [['rev-parse', 'HEAD'], { code: 0, stdout: 'oldsha\n', stderr: '' }],
    [['status', '--porcelain', '--untracked-files=no'], { code: 0, stdout: ' M apps/a.ts\n', stderr: '' }],
  ]);
  const wrapped = async (args) => { gitArgs.push(args); return runGit(args); };
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit: wrapped, runBash: async () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await u.applyUpdate();
  assert.equal(res.ok, false);
  assert.equal(res.rolledBack, false);
  assert.ok(!gitArgs.some((a) => a[0] === 'reset'));
});
