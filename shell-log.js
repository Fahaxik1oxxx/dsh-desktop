// 注入到页面：应用内日志面板。本文件在渲染端执行。
(function installDshLogViewer() {
  if (!window.dshLog) return;
  if (window.__dshLogInstalled) return;
  window.__dshLogInstalled = true;

  const css = document.createElement('style');
  css.id = 'dsh-log-css';
  css.textContent =
    '#dsh-log-overlay{position:fixed;right:16px;bottom:16px;width:min(640px,calc(100vw - 32px));' +
    'height:min(420px,60vh);z-index:2147483646;display:flex;flex-direction:column;' +
    'background:#1e1f22;color:#d6d9de;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);' +
    'overflow:hidden;font:12px/1.5 ui-sans-serif,system-ui,sans-serif;-webkit-app-region:no-drag;}' +
    '#dsh-log-overlay header{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;}' +
    '#dsh-log-overlay h4{margin:0;flex:1;font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;color:#fff;}' +
    '#dsh-log-overlay .meta{color:#8b9098;font-size:11px;}' +
    '#dsh-log-overlay pre{flex:1;margin:0;padding:8px 12px;overflow:auto;white-space:pre-wrap;' +
    'word-break:break-all;color:#c5c9d0;background:#16171a;}' +
    '#dsh-log-overlay .dsh-log-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:10px 12px;}' +
    '#dsh-log-overlay button{appearance:none;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;' +
    'font:600 12px ui-sans-serif,system-ui,sans-serif;background:rgba(255,255,255,.1);color:#fff;}' +
    '#dsh-log-overlay button.primary{background:#1f6feb;}';
  document.head.appendChild(css);

  let pollTimer = null;
  let lastText = '';

  function closeViewer() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    const el = document.getElementById('dsh-log-overlay');
    if (el) el.remove();
  }

  function ensureViewer() {
    let overlay = document.getElementById('dsh-log-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'dsh-log-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', '应用日志');
    const header = document.createElement('header');
    const h4 = document.createElement('h4');
    h4.textContent = '应用日志';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.id = 'dsh-log-meta';
    header.appendChild(h4);
    header.appendChild(meta);
    const pre = document.createElement('pre');
    pre.id = 'dsh-log-body';
    const actions = document.createElement('div');
    actions.className = 'dsh-log-actions';
    const mk = (label, cls) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      return b;
    };
    const copy = mk('复制');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(pre.textContent || ''); copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 1500); }
      catch { copy.textContent = '复制失败'; setTimeout(() => { copy.textContent = '复制'; }, 1500); }
    });
    const folder = mk('打开文件夹');
    folder.addEventListener('click', () => window.dshLog.reveal());
    const notepad = mk('记事本打开');
    notepad.addEventListener('click', () => window.dshLog.openExternal());
    const close = mk('关闭', 'primary');
    close.addEventListener('click', closeViewer);
    actions.appendChild(copy);
    actions.appendChild(folder);
    actions.appendChild(notepad);
    actions.appendChild(close);
    overlay.appendChild(header);
    overlay.appendChild(pre);
    overlay.appendChild(actions);
    document.body.appendChild(overlay);
    return overlay;
  }

  async function refresh() {
    const overlay = document.getElementById('dsh-log-overlay');
    if (!overlay) return;
    const data = await window.dshLog.read();
    const pre = document.getElementById('dsh-log-body');
    const meta = document.getElementById('dsh-log-meta');
    if (!pre) return;
    const text = data && data.text ? data.text : '(还没有日志)';
    const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
    if (text !== lastText) {
      lastText = text;
      pre.textContent = text;
      if (atBottom) pre.scrollTop = pre.scrollHeight;
    }
    if (meta) {
      const size = data && typeof data.size === 'number' ? Math.round(data.size / 1024) + ' KB' : '';
      meta.textContent = (data && data.truncated ? '仅显示尾部 · ' : '') + size;
    }
  }

  async function openViewer() {
    ensureViewer();
    lastText = '';
    await refresh();
    const pre = document.getElementById('dsh-log-body');
    if (pre) pre.scrollTop = pre.scrollHeight;
    if (!pollTimer) pollTimer = setInterval(refresh, 1000);
  }

  window.dshLog.onOpen(openViewer);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('dsh-log-overlay')) closeViewer();
  });
})();
