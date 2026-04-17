// background.js — service worker
// Handles storage, alarms, and cross-tab aggregation

const DAILY_LIMITS = {
  chatgpt_free: { rpm: 3, rpd: 40, tpm: 30000 },
  chatgpt_plus: { rpm: 40, rpd: 200, tpm: 60000 },
  claude_free:  { rpm: 5, rpd: 25,  tpm: 50000 },
  claude_pro:   { rpm: 50, rpd: 500, tpm: 200000 },
  gemini_free:  { rpm: 15, rpd: 1500, tpm: 1000000 },
  gemini_pro:   { rpm: 60, rpd: 2000, tpm: 2000000 }
};

// Reset daily stats at midnight
chrome.alarms.create('daily-reset', {
  when: getNextMidnight(),
  periodInMinutes: 1440
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'daily-reset') {
    resetDailyStats();
  }
});

function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

async function resetDailyStats() {
  const data = await chrome.storage.local.get(null);
  const resetData = {};
  for (const key of Object.keys(data)) {
    if (key.endsWith('_daily')) {
      resetData[key] = { requests: 0, tokens: 0, reset_at: Date.now() };
    }
  }
  resetData['last_daily_reset'] = Date.now();
  await chrome.storage.local.set(resetData);
  console.log('[AI Tracker] Daily stats reset at midnight');
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TRACK_REQUEST') {
    handleTrackRequest(msg.data).then(sendResponse);
    return true;
  }
  if (msg.type === 'GET_STATS') {
    getAllStats().then(sendResponse);
    return true;
  }
  if (msg.type === 'CLEAR_DATA') {
    chrome.storage.local.clear().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'SET_TIER') {
    chrome.storage.local.set({ [`${msg.platform}_tier`]: msg.tier }).then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleTrackRequest(data) {
  const { platform, model, inputTokens, outputTokens, timestamp, conversationId } = data;
  const now = timestamp || Date.now();
  const dayKey = `${platform}_daily`;
  const sessionKey = `${platform}_session`;
  const historyKey = `${platform}_history`;

  const stored = await chrome.storage.local.get([dayKey, sessionKey, historyKey, `${platform}_tier`]);
  const tier = stored[`${platform}_tier`] || 'free';

  // Update daily
  const daily = stored[dayKey] || { requests: 0, tokens: 0, input_tokens: 0, output_tokens: 0, reset_at: now };
  daily.requests += 1;
  daily.input_tokens = (daily.input_tokens || 0) + (inputTokens || 0);
  daily.output_tokens = (daily.output_tokens || 0) + (outputTokens || 0);
  daily.tokens += (inputTokens || 0) + (outputTokens || 0);
  daily.last_request = now;

  // Update session
  const session = stored[sessionKey] || { requests: 0, tokens: 0, started_at: now, conversation_ids: [] };
  session.requests += 1;
  session.tokens += (inputTokens || 0) + (outputTokens || 0);
  session.last_request = now;
  if (conversationId && !session.conversation_ids.includes(conversationId)) {
    session.conversation_ids.push(conversationId);
  }

  // Append to history (keep last 200)
  const history = stored[historyKey] || [];
  history.push({ timestamp: now, model, inputTokens, outputTokens, conversationId });
  if (history.length > 200) history.splice(0, history.length - 200);

  // Calculate when rate limit resets (per minute)
  const minuteAgo = now - 60000;
  const recentInMinute = history.filter(h => h.timestamp > minuteAgo).length;
  const limits = DAILY_LIMITS[`${platform}_${tier}`] || DAILY_LIMITS[`${platform}_free`];
  const rpm_remaining = Math.max(0, limits.rpm - recentInMinute);

  // Next reset time
  const nextResetMs = getNextMidnight() - now;
  const nextResetStr = formatDuration(nextResetMs);

  await chrome.storage.local.set({
    [dayKey]: daily,
    [sessionKey]: session,
    [historyKey]: history
  });

  // Notify if approaching limits
  if (rpm_remaining <= 1) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Rate Limit Warning',
      message: `${capitalize(platform)}: Approaching per-minute request limit!`
    });
  }

  return {
    ok: true,
    daily,
    rpm_remaining,
    nextReset: nextResetStr,
    limits
  };
}

async function getAllStats() {
  const platforms = ['chatgpt', 'claude', 'gemini'];
  const keys = [];
  for (const p of platforms) {
    keys.push(`${p}_daily`, `${p}_session`, `${p}_history`, `${p}_tier`);
  }
  keys.push('last_daily_reset');

  const data = await chrome.storage.local.get(keys);
  const now = Date.now();
  const nextReset = getNextMidnight();

  const result = { platforms: {}, next_daily_reset: nextReset, next_reset_in: formatDuration(nextReset - now) };

  for (const p of platforms) {
    const tier = data[`${p}_tier`] || 'free';
    const limits = DAILY_LIMITS[`${p}_${tier}`] || DAILY_LIMITS[`${p}_free`];
    const daily = data[`${p}_daily`] || { requests: 0, tokens: 0, input_tokens: 0, output_tokens: 0 };
    const session = data[`${p}_session`] || { requests: 0, tokens: 0, started_at: now };
    const history = data[`${p}_history`] || [];

    // Requests in last minute
    const minuteAgo = now - 60000;
    const recentInMinute = history.filter(h => h.timestamp > minuteAgo).length;

    // Avg tokens per request
    const avgTokens = history.length > 0
      ? Math.round(history.reduce((a, h) => a + (h.inputTokens || 0) + (h.outputTokens || 0), 0) / history.length)
      : 0;

    // Context estimation (based on recent conversation)
    const recentConvo = history.slice(-10);
    const contextTokens = recentConvo.reduce((a, h) => a + (h.inputTokens || 0) + (h.outputTokens || 0), 0);

    result.platforms[p] = {
      tier,
      daily,
      session,
      limits,
      rpm_used: recentInMinute,
      rpm_remaining: Math.max(0, limits.rpm - recentInMinute),
      rpd_remaining: Math.max(0, limits.rpd - daily.requests),
      tpm_remaining: Math.max(0, limits.tpm - recentInMinute * avgTokens),
      context_tokens: contextTokens,
      avg_tokens_per_req: avgTokens,
      history_count: history.length,
      last_request: history.length > 0 ? history[history.length - 1].timestamp : null
    };
  }

  return result;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
