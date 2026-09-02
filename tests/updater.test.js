const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runUpdateChain, winToPosix } = require('../update-lib.js');
const { makeUpdater } = require('../updater.js');

test('runUpdateChain: 全步骤成功返回 ok', async () => {
  const steps = [1, 2, 3].map((n) => ({ name: 's' + n, fn: async () => ({ ok: true }) }));
  assert.deepEqual(await runUpdateChain(steps), { ok: true });
});

test('runUpdateChain: 任一步失败即短路且不再调用后续', async () => {
  const calls = [];
  const steps = [
    { name: 'a', fn: async () => { calls.push('a'); return { ok: true }; } },
    { name: 'b', fn: async () => { calls.push('b'); return { ok: false, reason: 'dirty' }; } },
    { name: 'c', fn: async () => { calls.push('c'); return { ok: true }; } },
  ];
  const res = await runUpdateChain(steps);
  assert.deepEqual(res, { ok: false, reason: 'dirty', at: 'b' });
  assert.deepEqual(calls, ['a', 'b']);
});

test('winToPosix: Windows 路径转 bash 风格', () => {
  assert.equal(winToPosix('D:\\AI\\DSH'), '/d/AI/DSH');
  assert.equal(winToPosix('C:\\Program Files\\Git'), '/c/Program Files/Git');
});

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

test('applyUpdate: 有 tracked 改动时在 dirty-check 中止且不执行 pull', async () => {
  let pullCalled = false;
  const runGit = fakeGit([
    [['rev-parse', 'HEAD'], { code: 0, stdout: 'oldsha\n', stderr: '' }],
    [['status', '--porcelain', '--untracked-files=no'], { code: 0, stdout: ' M apps/cli/src/x.ts\n', stderr: '' }],
    [['pull', '--ff-only', 'origin', 'master'], () => { pullCalled = true; return { code: 0, stdout: '', stderr: '' }; }],
  ]);
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit, runBash: async () => ({ code: 0, stdout: '', stderr: '' }) });
  const res = await u.applyUpdate();
  assert.equal(res.ok, false);
  assert.equal(res.at, 'dirty-check');
  assert.equal(pullCalled, false);
});

test('applyUpdate: 干净+可快进+无依赖变化时走完整链路成功', async () => {
  const calls = [];
  const runGit = fakeGit([
    [[], (args) => {
      calls.push(args[0]);
      const a = args[0];
      if (a === 'rev-parse') return { code: 0, stdout: 'newsha\n', stderr: '' };
      if (a === 'status') return { code: 0, stdout: '', stderr: '' };
      if (a === 'merge-base') return { code: 0, stdout: '', stderr: '' };
      if (a === 'pull') return { code: 0, stdout: '', stderr: '' };
      if (a === 'diff') return { code: 0, stdout: '', stderr: '' }; // 无 lockfile 变化
      return { code: 0, stdout: '', stderr: '' };
    }],
  ]);
  let built = false;
  const runBash = async () => { built = true; return { code: 0, stdout: 'done\n', stderr: '' }; };
  const u = makeUpdater({ repo: 'D:\\AI\\DSH', bashExe: 'C:\\x\\bash.exe' }, { runGit, runBash });
  const res = await u.applyUpdate();
  assert.equal(res.ok, true);
  assert.equal(res.sha, 'newsha');
  assert.ok(calls.includes('pull'));
  assert.equal(built, true);
});
