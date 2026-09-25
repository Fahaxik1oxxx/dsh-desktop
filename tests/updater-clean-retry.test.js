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

test('applyUpdate: 构建失败后 clean 并全量重试一次', async () => {
  const scripts = [];
  let headCalls = 0;
  const runGit = fakeGit([
    [['rev-parse', 'HEAD'], () => ({ code: 0, stdout: (headCalls += 1) === 1 ? 'oldsha\n' : 'newsha\n', stderr: '' })],
    [['status', '--porcelain', '--untracked-files=no'], { code: 0, stdout: '', stderr: '' }],
    [['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
    [['merge', '--ff-only', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
    [['diff'], diffResponse],
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

test('applyUpdate: clean 重试仍失败时如实报错', async () => {
  const runGit = fakeGit([
    [['rev-parse', 'HEAD'], { code: 0, stdout: 'oldsha\n', stderr: '' }],
    [['status', '--porcelain', '--untracked-files=no'], { code: 0, stdout: '', stderr: '' }],
    [['merge-base', '--is-ancestor', 'HEAD', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
    [['merge', '--ff-only', 'FETCH_HEAD'], { code: 0, stdout: '', stderr: '' }],
    [['diff'], diffResponse],
  ]);
  const runBash = async () => ({ code: 1, stdout: 'Missing export\n', stderr: '' });
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit, runBash });
  const res = await u.applyUpdate();
  assert.equal(res.ok, false);
  assert.equal(res.at, 'build');
  assert.match(res.reason, /Missing export/);
});
