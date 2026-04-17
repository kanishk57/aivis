// content/gemini.js — injected into gemini.google.com
// Tracks requests via DOM observation

(function () {
  'use strict';

  const PLATFORM = 'gemini';
  let currentModel = 'gemini-pro';
  let conversationId = null;
  let lastObservedSignature = null;
  let lastObservedAt = 0;
  let lastSentSignature = null;
  let lastNetworkAt = 0;
  let checkTimer = null;

  function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
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
    if (Date.now() - lastNetworkAt < 10000) return;

    const userText = getLatestText('.user-query-text, [data-message-role="user"], user-query');
    const assistantText = getLatestText('.response-content, [data-message-role="model"], model-response');
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

  function trackFromNetworkPayload(payload) {
    const requestBody = payload?.requestBody || '';
    const responseText = payload?.responseText || '';
    if (!requestBody && !responseText) return;

    const signature = hashString(`${payload.url || ''}|${requestBody.slice(-300)}|${responseText.slice(-800)}`);
    if (signature === lastSentSignature) return;

    const inputTokens = estimateTokens(requestBody);
    const outputTokens = estimateTokens(responseText);
    if (inputTokens === 0 && outputTokens === 0) return;

    lastNetworkAt = Date.now();
    lastSentSignature = signature;

    chrome.runtime.sendMessage({
      type: 'TRACK_REQUEST',
      data: {
        platform: PLATFORM,
        model: currentModel,
        inputTokens,
        outputTokens,
        timestamp: Date.now(),
        conversationId
      }
    });
  }

  function injectHookScript() {
    if (document.getElementById('ai-token-tracker-hook')) return;
    const script = document.createElement('script');
    script.id = 'ai-token-tracker-hook';
    script.src = chrome.runtime.getURL('content/injected-hook.js');
    script.onload = () => script.remove();
    (document.documentElement || document.head).appendChild(script);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'ai-token-tracker-net' || data.platform !== PLATFORM) return;
    if (data.payload?.type === 'HOOK_READY') {
      console.log('[AI Tracker] Gemini network hook ready');
      return;
    }
    trackFromNetworkPayload(data.payload);
  });

  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = setTimeout(trackIfStable, 800);
  }

  const observer = new MutationObserver(() => {
    const modelEl = document.querySelector('[aria-label*="model"], .model-selector span');
    if (modelEl) currentModel = modelEl.innerText.trim() || currentModel;

    const match = location.pathname.match(/\/app\/([a-z0-9_-]+)/i);
    if (match) conversationId = match[1];

    scheduleCheck();
  });

  observer.observe(document.body, { childList: true, subtree: true });

  const match = location.pathname.match(/\/app\/([a-z0-9_-]+)/i);
  if (match) conversationId = match[1];

  injectHookScript();
  setInterval(trackIfStable, 2000);

  console.log('[AI Tracker] Gemini DOM tracker loaded');
})();
