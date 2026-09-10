// update-ui.js — 设置旁更新芯片的文案与样式。渲染端与单测共用。

function short(s) { return (s || '').slice(0, 8); }

/**
 * @param {{status:string, localSha?:string|null, remoteSha?:string|null, step?:string, error?:string}} state
 * @returns {{text:string, cls:string, title:string, action:string|null}|null}
 */
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

module.exports = { chipSpec, short };
