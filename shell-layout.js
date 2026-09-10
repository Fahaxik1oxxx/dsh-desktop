// shell-layout.js — 桌面壳注入的布局 CSS。给自绘窗口控件留出右上角。

/**
 * @param {number} controlWidth 自绘最小化/最大化/关闭条宽度
 * @returns {string} 注入到页面的 CSS
 */
function shellLayoutCss(controlWidth) {
  return (
    'button,input,textarea,select,a,[role="button"],[contenteditable="true"]{-webkit-app-region:no-drag}' +
    'header>div:first-of-type{justify-content:flex-start !important;}' +
    'header>div:first-of-type>div:first-of-type{flex:0 1 auto !important;min-width:0 !important;}' +
    '[data-conversation-header-corner]{margin-right:' + (controlWidth - 20) + 'px !important;}' +
    '[data-dockkit-strip-chrome]{margin-right:' + controlWidth + 'px !important;}'
  );
}

module.exports = { shellLayoutCss };
