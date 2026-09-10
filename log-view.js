// log-view.js — 日志尾巴切片，供主进程与单测共用。

const DEFAULT_MAX_BYTES = 128 * 1024;

/**
 * 取文本尾部，尽量从完整行开始。
 * @param {string} content
 * @param {number} [maxBytes]
 * @returns {{text:string, truncated:boolean}}
 */
function tailText(content, maxBytes = DEFAULT_MAX_BYTES) {
  const raw = String(content || '');
  if (Buffer.byteLength(raw) <= maxBytes) return { text: raw, truncated: false };
  let start = raw.length;
  let bytes = 0;
  while (start > 0 && bytes < maxBytes) {
    start -= 1;
    bytes += Buffer.byteLength(raw[start]);
  }
  const nl = raw.indexOf('\n', start);
  const slice = nl >= 0 && nl < raw.length - 1 ? raw.slice(nl + 1) : raw.slice(start);
  return { text: slice, truncated: true };
}

module.exports = { tailText, DEFAULT_MAX_BYTES };
