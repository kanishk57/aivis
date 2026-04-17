// content/claude.js — injected into claude.ai
// Tracks requests via DOM observation (more reliable than fetch interception)

(function () {
  'use strict';

  const PLATFORM = 'claude';
  let currentModel = 'claude-sonnet';
  let conversationId = null;
  let lastObservedSignature = null;
  let lastObservedAt = 0;
  let lastSentSignature = null;
  let checkTimer = null;

  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 3.5);
  }

  function hashString(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) + str.charCodeAt(i);
      h |= 0;
    }
    return String(h);
  }

  function getLatestText(selectors) {
    const nodes = Array.from(document.querySelectorAll(selectors));
    for (let i = nodes.length - 1; i >= 0; i--) {
      const txt = (nodes[i].innerText || '').trim();
      if (txt) return txt;
    }
    return '';
  }

  function trackIfStable() {
    const userText = getLatestText('[data-testid="user-message"], .font-user-message');
    const assistantText = getLatestText('[data-testid="assistant-message"], .font-claude-message, [data-testid*="assistant"]');
    if (!assistantText) return;

    const signatureBase = `${conversationId || location.pathname}|${userText.slice(-300)}|${assistantText.slice(-800)}`;
    const signature = hashString(signatureBase);
    const now = Date.now();

    if (signature !== lastObservedSignature) {
      lastObservedSignature = signature;
      lastObservedAt = now;
      return;
    }

    if (signature === lastSentSignature) return;
    if (now - lastObservedAt < 1800) return;

    const inputTokens = estimateTokens(userText);
    const outputTokens = estimateTokens(assistantText);
    if (inputTokens === 0 && outputTokens === 0) return;

    chrome.runtime.sendMessage({
      type: 'TRACK_REQUEST',
      data: {
        platform: PLATFORM,
        model: currentModel,
        inputTokens,
        outputTokens,
        timestamp: now,
        conversationId
      }
    });

    lastSentSignature = signature;
  }

  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(trackIfStable, 800);
  }

  const observer = new MutationObserver(() => {
    const match = location.pathname.match(/\/chat\/([a-z0-9-]+)/);
    if (match) conversationId = match[1];

    const modelEl = document.querySelector('[data-testid="model-selector"] span, button[aria-label*="model"] span');
    if (modelEl) currentModel = modelEl.innerText.trim();

    scheduleCheck();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  const match = location.pathname.match(/\/chat\/([a-z0-9-]+)/);
  if (match) conversationId = match[1];

  setInterval(trackIfStable, 2000);

  console.log('[AI Tracker] Claude DOM tracker loaded');
})();
