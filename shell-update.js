// 注入到页面：更新状态芯片在「设置」旁，进度/结果在窗口内。本文件在渲染端执行。
(function installDshUpdateChrome() {
  if (!window.dshUpdate) return;
  if (window.__dshUpdateInstalled) {
    window.dshUpdate.getState().then(render);
    return;
  }
  window.__dshUpdateInstalled = true;

  const css = document.createElement('style');
  css.id = 'dsh-update-css';
  css.textContent =
    '#dsh-update-host{flex:none;display:flex;align-items:center;max-width:100%;}' +
    '#dsh-update-btn{appearance:none;border:0;margin:0;cursor:pointer;font:inherit;' +
    'display:inline-flex;align-items:center;justify-content:center;gap:6px;' +
    'height:32px;padding:0 10px;border-radius:10px;color:#1f6feb;background:rgba(31,111,235,.1);' +
    'font-size:13px;line-height:20px;font-weight:600;white-space:nowrap;-webkit-app-region:no-drag;}' +
    '#dsh-update-btn:hover{background:rgba(31,111,235,.16);}' +
    '#dsh-update-btn:disabled{opacity:.85;cursor:default;}' +
    '#dsh-update-btn.muted{color:#4a4f57;background:rgba(0,0,0,.06);}' +
    '#dsh-update-btn.muted:hover{background:rgba(0,0,0,.06);}' +
    '#dsh-update-btn.ok{color:#1a7f37;background:rgba(26,127,55,.1);}' +
    '#dsh-update-btn.ok:hover{background:rgba(26,127,55,.1);}' +
    '#dsh-update-btn.warn{color:#9a6700;background:rgba(154,103,0,.12);}' +
    '#dsh-update-btn.warn:hover{background:rgba(154,103,0,.12);}' +
    '#dsh-update-btn .dsh-up-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex:none;}' +
    '#dsh-update-overlay{position:fixed;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));' +
    'max-height:min(360px,50vh);z-index:2147483645;display:flex;flex-direction:column;' +
    'background:#1e1f22;color:#d6d9de;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);' +
    'overflow:hidden;font:12px/1.5 ui-sans-serif,system-ui,sans-serif;-webkit-app-region:no-drag;}' +
    '#dsh-update-overlay.toast{width:auto;max-width:min(360px,calc(100vw - 32px));max-height:none;}' +
    '#dsh-update-overlay header{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;}' +
    '#dsh-update-overlay.toast header{padding:10px 14px;}' +
    '#dsh-update-overlay h4{margin:0;flex:1;font:600 13px/1.3 ui-sans-serif,system-ui,sans-serif;color:#fff;}' +
    '#dsh-update-overlay .dsh-up-bar{height:2px;background:rgba(255,255,255,.08);overflow:hidden;}' +
    '#dsh-update-overlay .dsh-up-bar>i{display:block;height:100%;width:40%;background:#1f6feb;' +
    'animation:dsh-up-slide 1.1s ease-in-out infinite;}' +
    '@keyframes dsh-up-slide{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}' +
    '#dsh-update-overlay pre{flex:1;margin:0;padding:8px 12px 12px;overflow:auto;white-space:pre-wrap;' +
    'word-break:break-all;color:#c5c9d0;min-height:72px;}' +
    '#dsh-update-overlay .dsh-up-err{padding:0 12px 10px;color:#ff8a80;}' +
    '#dsh-update-overlay .dsh-up-actions{display:flex;justify-content:flex-end;gap:8px;padding:0 12px 12px;}' +
    '#dsh-update-overlay button{appearance:none;border:0;border-radius:8px;padding:6px 10px;cursor:pointer;' +
    'font:600 12px ui-sans-serif,system-ui,sans-serif;background:rgba(255,255,255,.1);color:#fff;}' +
    '#dsh-update-overlay button.primary{background:#1f6feb;}' +
    '@media (prefers-reduced-motion:reduce){#dsh-update-overlay .dsh-up-bar>i{animation:none;width:100%;}}';
  document.head.appendChild(css);

  function findSettingsRow() {
    const buttons = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'));
    const settings = buttons.find((b) => {
      const n = (b.getAttribute('aria-label') || '').trim();
      return n === '设置' || n === 'Settings';
    });
    return settings || null;
  }

  function ensureHost(settingsBtn) {
    let host = document.getElementById('dsh-update-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'dsh-update-host';
    }
    const row = settingsBtn.parentElement;
    if (!row) return host;
    const rail = row.getBoundingClientRect().width <= 48;
    if (rail) {
      if (host.parentElement !== row.parentElement || host.nextElementSibling !== row) {
        row.parentElement.insertBefore(host, row);
      }
    } else if (settingsBtn.nextElementSibling !== host) {
      settingsBtn.after(host);
    }
    return host;
  }

  function short(s) { return (s || '').slice(0, 8); }

  function chipSpec(state) {
    switch (state.status) {
      case 'checking':
        return { text: '检查中…', cls: 'muted', title: '正在检查更新', action: null };
      case 'busy':
        return { text: '请稍候', cls: 'muted', title: state.error || '已有检查/更新在进行中', action: null };
      case 'available':
        return { text: '更新', cls: '', title: '发现新版本 ' + short(state.localSha) + ' → ' + short(state.remoteSha), action: 'apply' };
      case 'applying':
        return { text: '更新中', cls: '', title: state.step || '正在更新', action: null };
      case 'current':
        return { text: state.step || '已是最新', cls: 'ok', title: '已是最新版本 ' + short(state.localSha), action: null };
      case 'unreachable':
        return { text: '无法检查', cls: 'warn', title: state.error || '无法连接 github.com', action: null };
      case 'diverged':
        return { text: '无法快进', cls: 'warn', title: state.error || '本地与上游无法快进', action: null };
      default:
        return null;
    }
  }

  function renderChip(host, state) {
    host.replaceChildren();
    const spec = chipSpec(state);
    if (!spec) return;
    const btn = document.createElement('button');
    btn.id = 'dsh-update-btn';
    btn.type = 'button';
    btn.disabled = !spec.action;
    btn.className = spec.cls;
    btn.title = spec.title;
    const dot = document.createElement('span');
    dot.className = 'dsh-up-dot';
    btn.appendChild(dot);
    btn.appendChild(document.createTextNode(spec.text));
    if (spec.action === 'apply') btn.addEventListener('click', () => window.dshUpdate.apply());
    host.appendChild(btn);
  }

  function renderOverlay(state) {
    let overlay = document.getElementById('dsh-update-overlay');
    const applying = state.status === 'applying';
    const failed = state.status === 'failed';
    const toast = state.status === 'checking' || state.status === 'current'
      || state.status === 'unreachable' || state.status === 'diverged' || state.status === 'busy';
    if (!applying && !failed && !toast) {
      if (overlay) overlay.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dsh-update-overlay';
      overlay.setAttribute('role', 'status');
      document.body.appendChild(overlay);
    }
    overlay.className = toast ? 'toast' : '';
    overlay.replaceChildren();
    const header = document.createElement('header');
    const h4 = document.createElement('h4');
    if (applying) h4.textContent = state.step || '正在更新…';
    else if (failed) h4.textContent = '更新失败';
    else if (state.status === 'current') h4.textContent = (state.step || '已是最新') + (state.localSha ? ' ' + short(state.localSha) : '');
    else if (state.status === 'checking') h4.textContent = '正在检查更新…';
    else if (state.status === 'busy') h4.textContent = state.error || '请稍候';
    else h4.textContent = state.error || '检查更新失败';
    header.appendChild(h4);
    overlay.appendChild(header);
    if (applying) {
      const bar = document.createElement('div');
      bar.className = 'dsh-up-bar';
      bar.appendChild(document.createElement('i'));
      overlay.appendChild(bar);
    }
    if (toast) return;
    const pre = document.createElement('pre');
    pre.textContent = state.log || '';
    overlay.appendChild(pre);
    if (state.error) {
      const err = document.createElement('div');
      err.className = 'dsh-up-err';
      err.textContent = state.error;
      overlay.appendChild(err);
    }
    if (failed) {
      const actions = document.createElement('div');
      actions.className = 'dsh-up-actions';
      const retry = document.createElement('button');
      retry.className = 'primary';
      retry.type = 'button';
      retry.textContent = '重试';
      retry.addEventListener('click', () => window.dshUpdate.apply());
      const close = document.createElement('button');
      close.type = 'button';
      close.textContent = '关闭';
      close.addEventListener('click', () => window.dshUpdate.dismiss());
      actions.appendChild(retry);
      actions.appendChild(close);
      overlay.appendChild(actions);
    }
    pre.scrollTop = pre.scrollHeight;
  }

  function render(state) {
    if (!state) return;
    const settingsBtn = findSettingsRow();
    const host = settingsBtn ? ensureHost(settingsBtn) : document.getElementById('dsh-update-host');
    if (host) renderChip(host, state);
    renderOverlay(state);
  }

  window.dshUpdate.getState().then(render);
  window.dshUpdate.onState(render);
  let moTimer;
  const mo = new MutationObserver(() => {
    if (document.getElementById('dsh-update-host') && findSettingsRow()) return;
    clearTimeout(moTimer);
    moTimer = setTimeout(() => { window.dshUpdate.getState().then(render); }, 200);
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
