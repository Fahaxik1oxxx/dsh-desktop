// web-url.js — 从 dsh web 启动输出里取出本进程的认证 URL。
// 只接受与 config 中 host/port 一致的 http(s) 地址，拒绝 LAN 与其它主机。

const MARKER = 'dsh web: ';

/**
 * 从一行或多行服务器输出中解析 `dsh web: <url>`。
 * 只返回与 expected.url 同源（协议、主机、端口）的地址；带 token 的查询串保留。
 * @param {string} text 子进程 stdout 片段
 * @param {{url:string, port:number}} expected 本地配置中的基址与端口
 * @returns {string|null} 可导航的绝对 URL，无法解析或不匹配时为 null
 */
function parseDshWebUrl(text, expected) {
  const idx = text.indexOf(MARKER);
  if (idx < 0) return null;
  const rest = text.slice(idx + MARKER.length);
  const end = rest.search(/[\s(]/);
  const raw = (end < 0 ? rest : rest.slice(0, end)).trim();
  let parsed;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username !== '' || parsed.password !== '') return null;
  let expectedUrl;
  try { expectedUrl = new URL(expected.url); } catch { return null; }
  if (parsed.hostname !== expectedUrl.hostname) return null;
  const expectedPort = String(expected.port);
  const actualPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  if (actualPort !== expectedPort) return null;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  return parsed.href;
}

module.exports = { parseDshWebUrl };
