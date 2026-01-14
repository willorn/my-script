// ==UserScript==
// @name         Modao Preview Zoom 80%
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Force Modao preview zoom to 80% and keep it there
// @match        https://modao.cc/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const targetScale = 0.8;
  const labelText = `${Math.round(targetScale * 100)}%`;
  const selectorZoomArea = '.zoom-area';
  const selectorLabel = '.zoom-scale';

  function applyZoom() {
    let changed = false;
    document.querySelectorAll(selectorZoomArea).forEach((node) => {
      const current = node.style.transform || '';
      const next = /scale\([^)]*\)/.test(current)
          ? current.replace(/scale\([^)]*\)/, `scale(${targetScale})`)
          : `scale(${targetScale})`;
      if (current !== next) {
        node.style.transform = next;
        changed = true;
      }
    });
    const label = document.querySelector(selectorLabel);
    if (label && label.textContent !== labelText) {
      label.textContent = labelText;
      changed = true;
    }
    return changed;
  }

  // Run once after load, then keep reapplying in case the page re-renders.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyZoom, { once: true });
  } else {
    applyZoom();
  }

  const observer = new MutationObserver(() => applyZoom());
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
