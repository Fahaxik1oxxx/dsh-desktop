const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../proc.js');

test('run: onOut 按块转发 stdout', async () => {
  const chunks = [];
  const res = await run(process.execPath, ['-e', "process.stdout.write('hello\\nworld\\n')"], {
    timeoutMs: 5000,
    onOut: (s) => chunks.push(s),
  });
  assert.equal(res.code, 0);
  assert.equal(chunks.join(''), 'hello\nworld\n');
});

test('run: 超时后终止子进程并返回结果', async () => {
  // 兜底守卫：若 kill 失效 run() 永不返回，10s 后拒绝；finally 里清除，避免拖住事件循环
  let bail;
  const guard = new Promise((_, reject) => {
    bail = setTimeout(() => reject(new Error('run() 未在 10s 内返回')), 10000);
  });
  try {
    const res = await Promise.race([
      run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 300 }),
      guard,
    ]);
    // 被强制终止：退出码非 0（Windows taskkill /F → 1；POSIX SIGKILL → code 为 null）
    assert.ok(res.code !== 0);
  } finally {
    clearTimeout(bail);
  }
});
