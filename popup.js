// popup.js — drives the extension UI

const CONTEXT_LIMITS = {
  chatgpt: 128000,
  claude: 200000,
  gemini: 1000000
};

const COLORS = { chatgpt: '#74aa9c', claude: '#d97757', gemini: '#4285f4' };

let allStats = null;

// --- Tab switching ---
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
}

document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => switchTab(t.dataset.tab));
});

// --- Tier selector ---
function setTier(platform, tier) {
  chrome.runtime.sendMessage({ type: 'SET_TIER', platform, tier }, () => loadStats());
}
window.setTier = setTier;

// --- Clear data ---
document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm('Clear all tracked data?')) {
    chrome.runtime.sendMessage({ type: 'CLEAR_DATA' }, () => loadStats());
  }
});

document.getElementById('tracking-toggle').addEventListener('change', (e) => {
  const enabled = !!e.target.checked;
  chrome.runtime.sendMessage({ type: 'SET_TRACKING_ENABLED', enabled }, () => loadStats());
});

// --- Helpers ---
function fmtK(n) {
  if (n === undefined || n === null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function barColor(pct) {
  if (pct >= 90) return 'red';
  if (pct >= 65) return 'amber';
  return 'green';
}

function setBar(id, pct) {
  const el = document.getElementById(id);
  if (!el) return;
  const p = Math.min(100, Math.max(0, pct));
  el.style.width = p + '%';
  el.className = `bar-fill ${barColor(p)}`;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function getResetStr(nextReset) {
  const ms = nextReset - Date.now();
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// --- Load stats from background ---
function loadStats() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (stats) => {
    if (!stats) return;
    allStats = stats;
    renderAll(stats);
  });
}

function renderAll(stats) {
  const platforms = ['chatgpt', 'claude', 'gemini'];

  // Reset timer
  setText('reset-timer', getResetStr(stats.next_daily_reset));

  const enabled = stats.tracking_enabled !== false;
  const toggle = document.getElementById('tracking-toggle');
  if (toggle) toggle.checked = enabled;
  setText('tracking-label', enabled ? 'Tracking ON' : 'Tracking OFF');

  // Restore tier selectors
  for (const p of platforms) {
    const sel = document.getElementById(`tier-${p}`);
    if (sel && stats.platforms[p]?.tier) sel.value = stats.platforms[p].tier;
  }

  // Overview cards
  for (const p of platforms) {
    const pd = stats.platforms[p];
    if (!pd) continue;
    setText(`ov-${p}-req`, pd.daily?.requests ?? 0);
    setText(`ov-${p}-tier`, pd.tier);

    const rpdPct = (pd.daily?.requests || 0) / pd.limits.rpd * 100;
    setBar(`bar-${p}-rpd`, rpdPct);
    setText(`val-${p}-rpd`, `${pd.daily?.requests || 0}/${pd.limits.rpd}`);

    const tpdPct = (pd.daily?.tokens || 0) / (pd.limits.tpm * 60) * 100;
    setBar(`bar-${p}-tpd`, Math.min(tpdPct, 100));
    setText(`val-${p}-tpd`, fmtK(pd.daily?.tokens || 0));
  }

  // Detail panels
  for (const p of platforms) {
    const pd = stats.platforms[p];
    if (!pd) continue;
    const reqs = pd.daily?.requests || 0;
    const tokens = pd.daily?.tokens || 0;
    const rpmUsed = pd.rpm_used || 0;
    const sessReqs = pd.session?.requests || 0;

    setText(`d-${p}-rpd`, reqs);
    setText(`d-${p}-rpd-lim`, `of ${pd.limits.rpd} limit`);
    setText(`d-${p}-tpd`, fmtK(tokens));
    setText(`d-${p}-tpd-lim`, `of ${fmtK(pd.limits.tpm)}/min limit`);
    setText(`d-${p}-rpm`, rpmUsed);
    setText(`d-${p}-rpm-lim`, `of ${pd.limits.rpm} limit`);
    setText(`d-${p}-sess`, sessReqs);

    const rpmRem = pd.rpm_remaining || 0;
    setText(`d-${p}-rpm-rem`, `${rpmRem} remaining`);
    const rpmPct = rpmUsed / pd.limits.rpm * 100;
    setBar(`bar2-${p}-rpm`, rpmPct);

    const rpdRem = pd.rpd_remaining || 0;
    setText(`d-${p}-rpd-rem`, `${rpdRem} remaining`);
    const rpdPct = reqs / pd.limits.rpd * 100;
    setBar(`bar2-${p}-rpd`, rpdPct);

    setText(`d-${p}-reset`, `in ${getResetStr(stats.next_daily_reset)}`);
  }

  // Context panel
  for (const p of platforms) {
    const pd = stats.platforms[p];
    if (!pd) continue;
    const ctx = pd.context_tokens || 0;
    const limit = CONTEXT_LIMITS[p];
    const pct = Math.min(ctx / limit * 100, 100);
    const el = document.getElementById(`ctx-${p}`);
    if (el) el.style.width = pct + '%';
    setText(`ctx-${p}-label`, `${fmtK(ctx)} / ${fmtK(limit)}`);
  }

  // History list
  const allHistory = [];
  for (const p of platforms) {
    const pd = stats.platforms[p];
    if (!pd) continue;
    const history = pd._history || [];
  }

  // Rebuild from all platform histories (we need raw data)
  chrome.storage.local.get(['chatgpt_history', 'claude_history', 'gemini_history'], (data) => {
    const items = [];
    for (const p of platforms) {
      const hist = data[`${p}_history`] || [];
      hist.forEach(h => items.push({ ...h, platform: p }));
    }
    items.sort((a, b) => b.timestamp - a.timestamp);
    const recent = items.slice(0, 20);

    const container = document.getElementById('history-list');
    if (recent.length === 0) {
      container.innerHTML = `<div class="empty"><div class="icon">💬</div>No requests tracked yet.<br>Open a chat and start a conversation.</div>`;
      return;
    }

    container.innerHTML = recent.map(item => {
      const time = new Date(item.timestamp);
      const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const total = (item.inputTokens || 0) + (item.outputTokens || 0);
      const color = COLORS[item.platform] || '#888';
      const model = item.model || item.platform;
      return `<div class="history-item">
        <span class="h-dot" style="background:${color}"></span>
        <span class="h-time">${timeStr}</span>
        <span class="h-model">${model}</span>
        <span class="h-tokens">${fmtK(total)} tok</span>
      </div>`;
    }).join('');
  });
}

// Initial load and auto-refresh
loadStats();
setInterval(loadStats, 1000);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const keys = Object.keys(changes || {});
  if (keys.some(k => k.endsWith('_daily') || k.endsWith('_session') || k.endsWith('_history') || k.endsWith('_tier'))) {
    loadStats();
  }
});
