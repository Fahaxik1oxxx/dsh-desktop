// proc.js — 子进程执行器。捕获 stdout/stderr，超时 kill，不抛异常，只返回结果对象。
const { spawn } = require('node:child_process');

/**
 * @param {string} exe 可执行文件路径
 * @param {string[]} args 参数数组
 * @param {{cwd?:string, env?:NodeJS.ProcessEnv, timeoutMs?:number}} opts
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function run(exe, args, { cwd, env, timeoutMs = 300000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, env, windowsHide: true, shell: false });
    let stdout = '';
    let stderr = '';
    const t = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
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
