// ==UserScript==
// @name         Gemini 宽屏助手
// @namespace    https://gemini.google.com/
// @version      1.2.0
// @description  强制 Gemini 网页使用宽屏布局（对话容器、用户消息气泡、输入区、表格）
// @match        https://gemini.google.com/*
// @match        https://aistudio.google.com/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  const css = `
/* 1) 最外层容器 */
.conversation-container,
main > div {
  max-width: 92% !important;
}

/* 2) 底部输入框区域保持宽屏 */
.input-area-container,
.bottom-container,
div[class*="input-area"] {
  max-width: 92% !important;
  width: 92% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

/* 3) 用户消息宿主（自定义标签）占满可用空间 */
user-query,
user-query-content {
  max-width: 100% !important;
  width: 100% !important;
  flex: 1 1 auto !important;
}

/* 4) 右对齐容器改为占满并靠左 */
span.user-query-container,
div.user-query-container,
.right-align-content {
  max-width: 100% !important;
  width: 100% !important;
  margin-left: 0 !important;
  justify-content: flex-start !important;
}

/* 5) 用户消息灰色气泡背景拉满，圆角稍微变小 */
.user-query-bubble-with-background,
.user-query-bubble-container {
  max-width: 100% !important;
  width: 100% !important;
  border-radius: 8px !important;
}

/* 6) 气泡内文字与图片轮播拉满宽度 */
.query-text,
.query-text-line,
user-query-file-carousel,
.file-preview-container {
  max-width: 100% !important;
  width: 100% !important;
}

/* 7) 表格宽度适配页面 */
table {
  max-width: 100% !important;
  width: 100% !important;
  table-layout: auto !important;
}

/* 表格容器 */
.table-container,
markdown-table,
.table-wrapper,
div[class*="table"] {
  max-width: 100% !important;
  width: 100% !important;
  overflow-x: auto !important;
}

/* 表格单元格 */
th, td {
  max-width: none !important;
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
}

/* （可选）如图片被拉伸过大可开启此段 */
// img.preview-image {
//   width: auto !important;
//   max-height: 300px !important;
// }
`;

  // 注入样式（兼容无 GM_addStyle 的环境）
  try {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
    } else {
      const style = document.createElement('style');
      style.id = 'gemini-wide-style';
      style.textContent = css;
      document.documentElement.appendChild(style);
    }
  } catch (e) {
    const style = document.createElement('style');
    style.id = 'gemini-wide-style';
    style.textContent = css;
    document.documentElement.appendChild(style);
  }
})();
