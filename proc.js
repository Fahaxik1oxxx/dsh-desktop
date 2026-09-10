// proc.js — 子进程执行器。捕获 stdout/stderr，超时杀整个进程树，不抛异常，只返回结果对象。
const { spawn, execFile } = require('node:child_process');

/**
 * 终止 child 及其全部后代：Windows 上 child.kill() 只杀直接子进程，
 * bash/pnpm/npm 的孙进程会残留并占用文件句柄，须用 taskkill /T /F 杀进程树。
 */
function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {});
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * @param {string} exe 可执行文件路径
 * @param {string[]} args 参数数组
 * @param {{cwd?:string, env?:NodeJS.ProcessEnv, timeoutMs?:number, onOut?:(chunk:string)=>void}} opts
 * @returns {Promise<{code:number|null, stdout:string, stderr:string}>}
 */
function run(exe, args, { cwd, env, timeoutMs = 300000, onOut } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, env, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => killTree(child), timeoutMs);
    const take = (d) => {
      const s = d.toString();
      if (onOut) onOut(s);
      return s;
    };
    child.stdout.on('data', (d) => { stdout += take(d); });
    child.stderr.on('data', (d) => { stderr += take(d); });
    child.on('error', (e) => {
      clearTimeout(t);
      resolve({ code: -1, stdout, stderr: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve({ code, stdout, stderr });
    });
  });
}

module.exports = { run };
