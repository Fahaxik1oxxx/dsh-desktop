// update-lib.js — 可测的更新编排核心与路径工具。
/**
 * 顺序执行 steps（{name, fn}[]）。某步 fn 返回 {ok:false, reason} 即短路；
 * 全过返回 {ok:true}。
 */
async function runUpdateChain(steps) {
  for (const s of steps) {
    const r = await s.fn();
    if (!r.ok) return { ok: false, reason: r.reason, at: s.name };
  }
  return { ok: true };
}

/** Windows 路径 -> Git Bash 风格 posix 路径：D:\AI\DSH -> /d/AI/DSH */
function winToPosix(p) {
  const m = /^([A-Za-z]):\\(.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, '/');
  return '/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

module.exports = { runUpdateChain, winToPosix };
