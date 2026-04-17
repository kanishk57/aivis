// content/injected-hook.js
// Runs in page context to observe real fetch traffic and forward lightweight payloads.

(function () {
  'use strict';

  if (window.__AI_TRACKER_NET_HOOK__) return;
  window.__AI_TRACKER_NET_HOOK__ = true;

  function getPlatform() {
    const host = location.hostname;
    if (host === 'chat.openai.com' || host === 'chatgpt.com') return 'chatgpt';
    if (host === 'claude.ai') return 'claude';
    if (host === 'gemini.google.com') return 'gemini';
    return null;
  }

  function isTrackedUrl(platform, url) {
    if (!url) return false;
    if (platform === 'chatgpt') {
      return /\/backend-api\/conversation|\/v1\/chat\/completions|\/backend-anon\/conversation/.test(url);
    }
    if (platform === 'claude') {
      return /\/api\/organizations\/|\/chat_conversations|\/messages|\/completion/.test(url);
    }
    if (platform === 'gemini') {
      return /BardChatUi|generativelanguage\.googleapis\.com|\/api\/generate|streamGenerateContent/.test(url);
    }
    return false;
  }

  function normalizeBody(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    try {
      if (body instanceof URLSearchParams) return body.toString();
      if (body instanceof FormData) {
        const parts = [];
        for (const pair of body.entries()) {
          parts.push(String(pair[0]) + '=' + String(pair[1]));
        }
        return parts.join('&');
      }
      if (body instanceof Blob) return '[blob]';
      if (body instanceof ArrayBuffer) return '[arraybuffer]';
      if (ArrayBuffer.isView(body)) return '[typedarray]';
      return String(body);
    } catch (e) {
      return '';
    }
  }

  function postNetworkPayload(platform, payload) {
    window.postMessage({
      source: 'ai-token-tracker-net',
      platform,
      payload
    }, '*');
  }

  const platform = getPlatform();
  if (!platform) return;

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const init = args[1] || {};
    const url = request && request.url ? String(request.url) : String(request || '');

    const response = await originalFetch.apply(this, args);

    if (!isTrackedUrl(platform, url)) return response;

    let requestBody = normalizeBody(init.body);
    if (!requestBody && request && typeof request.clone === 'function') {
      try {
        requestBody = await request.clone().text();
      } catch (e) {}
    }

    let responseText = '';
    try {
      responseText = await response.clone().text();
    } catch (e) {}

    postNetworkPayload(platform, {
      url,
      requestBody: requestBody ? requestBody.slice(0, 12000) : '',
      responseText: responseText ? responseText.slice(0, 20000) : '',
      timestamp: Date.now()
    });

    return response;
  };

  window.postMessage({
    source: 'ai-token-tracker-net',
    platform,
    payload: { type: 'HOOK_READY', timestamp: Date.now() }
  }, '*');
})();
