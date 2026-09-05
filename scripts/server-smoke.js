// server-smoke.js — 非 GUI 冒烟：拉起真实 dsh 服务器，等 3080 就绪，停掉后断言端口已释放。
// 运行：D:\Compile\Node\node.exe scripts/server-smoke.js
const path = require('node:path');
const net = require('node:net');
const { startServer } = require('../server.js');
const { loadConfig } = require('../config-lib.js');

const cfg = loadConfig(path.join(__dirname, '..', 'config.json'));

/** 轮询直到端口无法连接（已释放），或超时。 */
function waitForPortGone(port, { host = '127.0.0.1', timeoutMs = 10000, intervalMs = 300 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tryOnce = () => {
      const s = net.connect({ port, host });
      s.once('connect', () => { s.destroy(); if (Date.now() - t0 > timeoutMs) reject(new Error('port still listening')); else setTimeout(tryOnce, intervalMs); });
      s.once('error', () => { s.destroy(); resolve(); }); // 拒绝连接 = 已释放
    };
    tryOnce();
  });
}

(async () => {
  try {
    const s = startServer(cfg, (l) => process.stdout.write(l));
    await s.ready;
    console.log('\n[smoke] SERVER READY on port', cfg.port);
    await s.stop();
    await waitForPortGone(cfg.port);
    console.log('[smoke] port', cfg.port, 'released after stop (clean)');
    process.exit(0);
  } catch (e) {
    console.error('[smoke] FAIL:', e.message);
    process.exit(1);
  }
})();
