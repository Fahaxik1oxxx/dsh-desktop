// server.js — 拉起 dsh web 服务器子进程、健康检查、停止清理。
const { spawn, execFile } = require('node:child_process');
const net = require('node:net');

/** 轮询 TCP 端口直到可连接或超时。 */
function waitForPort(port, { host = '127.0.0.1', timeoutMs = 90000, intervalMs = 500 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tryOnce = () => {
      const s = net.connect({ port, host });
      s.once('connect', () => { s.destroy(); resolve(); });
      s.once('error', () => {
        s.destroy();
        if (Date.now() - t0 > timeoutMs) reject(new Error(`server not ready on ${host}:${port} within ${timeoutMs}ms`));
        else setTimeout(tryOnce, intervalMs);
      });
    };
    tryOnce();
  });
}

/**
 * @param {object} cfg 应用配置（nodeExe/serverArgs/repo/port）
 * @param {(line:string)=>void} onOut 子进程输出回调（用于日志）
 * @returns {{child, ready:Promise<void>, stop:()=>Promise<void>}}
 */
function startServer(cfg, onOut = () => {}) {
  const child = spawn(cfg.nodeExe, cfg.serverArgs, {
    cwd: cfg.repo,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stdout.on('data', (d) => onOut(d.toString()));
  child.stderr.on('data', (d) => { stderr += d; onOut(d.toString()); });

  let settled = false;
  const ready = new Promise((resolve, reject) => {
    const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
    waitForPort(cfg.port).then(() => { settled = true; resolve(); }, () => fail(`server did not become ready on port ${cfg.port}`));
    child.once('exit', (code, sig) => fail(`server exited early (code=${code}, sig=${sig}) stderr: ${stderr.slice(-500)}`));
  });

  async function stop() {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.kill();
      const t = setTimeout(() => {
        // Windows 回退：taskkill 杀掉进程树
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => { clearTimeout(t); resolve(); });
      }, 2500);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }

  return { child, ready, stop };
}

module.exports = { startServer, waitForPort };
