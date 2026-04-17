# AIVIS — Chrome Extension

Track usage, rate limits, and context across ChatGPT, Claude, and Gemini.
No account setup required.

---

## What it tracks

| Feature | ChatGPT | Claude | Gemini |
|---|---|---|---|
| Requests per day | ✓ | ✓ | ✓ |
| Requests per minute | ✓ | ✓ | ✓ |
| Token usage (est.) | ✓ | ✓ | ✓ |
| Context window used | ✓ | ✓ | ✓ |
| Daily reset countdown | ✓ | ✓ | ✓ |
| Rate limit warnings | ✓ | ✓ | ✓ |
| Session tracking | ✓ | ✓ | ✓ |
| Request history | Last 200 | Last 200 | Last 200 |

---

## Installation (Developer Mode)

1. Download or unzip this folder somewhere permanent on your computer
2. Open Chrome → navigate to `chrome://extensions`
3. Toggle **Developer mode** ON (top right)
4. Click **Load unpacked**
5. Select this folder (`ai-token-tracker/`)
6. The extension icon appears in your toolbar — pin it!

---

## Setup

After installing, click the extension icon and:
- Set your **plan/tier** for each platform in each platform's tab
  - ChatGPT: Free or Plus
  - Claude: Free or Pro
  - Gemini: Free or Advanced
- This sets the correct rate limits for your account

---

## Screenshots

### Overview

![Overview](ss/Screenshot%20From%202026-04-17%2020-48-35.png)

### Gemini Tab

![Gemini Tab](ss/Screenshot%20From%202026-04-17%2020-48-48.png)

### Context Tab

![Context Tab](ss/Screenshot%20From%202026-04-17%2020-48-59.png)

---

## How it works

The extension injects content scripts into ChatGPT, Claude, and Gemini pages.
These scripts intercept the streaming API responses (the same ones the chat UI uses)
and extract or estimate token counts.

**Token estimation accuracy:**
- Claude: ~95% accurate (Claude's SSE stream includes exact usage counts)
- ChatGPT: ~85% accurate (uses usage headers when available, falls back to 4 chars/token)
- Gemini: ~80% accurate (uses usageMetadata when available, falls back to DOM text)

All data is stored in `chrome.storage` for this extension.

---

## Rate limits used (approximate, as of 2025)

### ChatGPT
| Plan | RPM | RPD | TPM |
|---|---|---|---|
| Free | 3 | 40 | 30k |
| Plus | 40 | 200 | 60k |

### Claude
| Plan | RPM | RPD | TPM |
|---|---|---|---|
| Free | 5 | 25 | 50k |
| Pro | 50 | 500 | 200k |

### Gemini
| Plan | RPM | RPD | TPM |
|---|---|---|---|
| Free | 15 | 1500 | 1M |
| Advanced | 60 | 2000 | 2M |

> Note: Actual limits vary and change over time. These are estimates based on publicly available info.

---

## Privacy

- Zero network requests from this extension
- No analytics, no telemetry
- Clear all data anytime via the "Clear data" button

---

## Limitations

- Token counts for ChatGPT and Gemini are **estimates** (the actual counts are in backend systems you can't directly access from the browser)
- Rate limits are hardcoded approximations — OpenAI/Anthropic/Google don't expose live limit data to the browser
- The extension resets daily stats at midnight
- If you clear browser data, extension storage is also cleared
