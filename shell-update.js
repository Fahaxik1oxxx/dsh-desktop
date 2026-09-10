// 注入到页面：有更新时在「设置」旁边放按钮，应用中显示进度。本文件在渲染端执行。
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
    '#dsh-update-host{flex:none;display:flex;align-items:center;}' +
    '#dsh-update-btn{appearance:none;border:0;margin:0;cursor:pointer;font:inherit;' +
    'display:inline-flex;align-items:center;justify-content:center;gap:6px;' +
    'height:32px;padding:0 10px;border-radius:10px;color:#1f6feb;background:rgba(31,111,235,.1);' +
    'font-size:13px;line-height:20px;font-weight:600;-webkit-app-region:no-drag;}' +
    '#dsh-update-btn:hover{background:rgba(31,111,235,.16);}' +
    '#dsh-update-btn:disabled{opacity:.7;cursor:default;}' +
    '#dsh-update-btn .dsh-up-dot{width:7px;height:7px;border-radius:50%;background:#1f6feb;flex:none;}' +
    '#dsh-update-overlay{position:fixed;right:16px;bottom:16px;width:min(420px,calc(100vw - 32px));' +
    'max-height:min(360px,50vh);z-index:2147483645;display:flex;flex-direction:column;' +
    'background:#1e1f22;color:#d6d9de;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.28);' +
    'overflow:hidden;font:12px/1.5 ui-sans-serif,system-ui,sans-serif;-webkit-app-region:no-drag;}' +
    '#dsh-update-overlay header{display:flex;align-items:center;gap:8px;padding:10px 12px 8px;}' +
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

  function render(state) {
    if (!state) return;
    const settingsBtn = findSettingsRow();
    const host = settingsBtn ? ensureHost(settingsBtn) : document.getElementById('dsh-update-host');
    if (host) {
      host.replaceChildren();
      if (state.status === 'available' || state.status === 'applying') {
        const btn = document.createElement('button');
        btn.id = 'dsh-update-btn';
        btn.type = 'button';
        const applying = state.status === 'applying';
        btn.disabled = applying;
        btn.title = applying
          ? '正在更新'
          : ('发现新版本 ' + short(state.localSha) + ' → ' + short(state.remoteSha));
        const dot = document.createElement('span');
        dot.className = 'dsh-up-dot';
        btn.appendChild(dot);
        btn.appendChild(document.createTextNode(applying ? '更新中' : '更新'));
        btn.addEventListener('click', () => { if (!applying) window.dshUpdate.apply(); });
        host.appendChild(btn);
      }
    }

    let overlay = document.getElementById('dsh-update-overlay');
    const showOverlay = state.status === 'applying' || state.status === 'failed';
    if (!showOverlay) {
      if (overlay) overlay.remove();
      return;
    }
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'dsh-update-overlay';
      overlay.setAttribute('role', 'status');
      document.body.appendChild(overlay);
    }
    const applying = state.status === 'applying';
    overlay.replaceChildren();
    const header = document.createElement('header');
    const h4 = document.createElement('h4');
    h4.textContent = applying ? (state.step || '正在更新…') : '更新失败';
    header.appendChild(h4);
    overlay.appendChild(header);
    if (applying) {
      const bar = document.createElement('div');
      bar.className = 'dsh-up-bar';
      bar.appendChild(document.createElement('i'));
      overlay.appendChild(bar);
    }
    const pre = document.createElement('pre');
    pre.textContent = state.log || '';
    overlay.appendChild(pre);
    if (state.error) {
      const err = document.createElement('div');
      err.className = 'dsh-up-err';
      err.textContent = state.error;
      overlay.appendChild(err);
    }
    if (!applying) {
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
