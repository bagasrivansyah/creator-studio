# Creator Studio — Hybrid AI for Short-Form Creators

An entry for **#BuildHybridAI 2026** (Google / Firebase) on Devpost.

Creator Studio is an AI assistant for short-form video creators. It turns one
topic into a complete content package — hooks, caption + hashtags, a full
5-scene script, and titles + thumbnail text — using **Firebase AI Logic hybrid
inference**: quick, private brainstorming runs **on-device with Gemini Nano**,
while long-form writing runs **in the cloud with Gemini**. Every generation is
logged with where it actually ran, read from `inferenceSource` — never guessed.

## Why this split?

| Task | Where it runs | Why |
|---|---|---|
| Hooks (5 options) | On-device first (`PREFER_ON_DEVICE`) | Short, private, latency-sensitive. Free, instant, works offline. |
| Caption + hashtags | On-device first (`PREFER_ON_DEVICE`) | Same: short text the creator may not want leaving the device. |
| Full 5-scene script | Cloud (`ONLY_IN_CLOUD`, gemini-3.5-flash-lite) | Long-form structure and reasoning run in the cloud by design. |
| Titles + thumbnail text | Cloud (`ONLY_IN_CLOUD`, gemini-3.5-flash-lite) | Nuanced wording and keyword craft run in the cloud by design. |

If Gemini Nano isn't available on a browser, the on-device tasks fall back to
the cloud automatically (`gemini-3.5-flash-lite`), so the app works for 100%
of visitors. A routing switch lets the user force **Auto**, **On-device
first**, or **Cloud only**, and the routing panel shows the real outcome of
every call: task, model, latency, and the reason for the route.

`gemini-3.5-flash-lite` is the primary cloud model for every task, because
live testing on 21 Nov 2026 showed `gemini-3.8-flash` returning HTTP 500/503
on the Gemini Developer API backend, while lite answered in ~1–2s per task.
`gemini-3.8-flash` is kept as a one-time fallback if lite ever fails.

## Features

- **Hybrid inference, done honestly** — `InferenceMode.PREFER_ON_DEVICE` /
  `ONLY_IN_CLOUD`, `initializeDeviceModel()` with download progress, and
  `response.inferenceSource` displayed per task.
- **Structured output everywhere** — the same `Schema` drives the cloud model
  (`responseSchema`) and the on-device model (`responseConstraint`), so
  results render as real UI, not raw text.
- **Real creator craft in the prompts** — hooks in the first 3 seconds, one
  sharp moment per video, on-screen text synced to the spoken words, and a
  rule against inventing quotes or facts.
- **English + Bahasa Indonesia** output (the UI is English; generation
  language is selectable).
- **Save projects** to Firestore under anonymous Auth; offline-safe
  localStorage fallback with an honest "saved locally" label.
- **App Check** wired in (reCAPTCHA v3 when configured, debug provider for
  development — debug tokens are accepted by the contest rules).
- **Demo mode** — with no Firebase config, the app runs with clearly-labelled
  sample output so anyone can preview the full UX without an account.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Creator Studio (Vite + vanilla JS, single page)             │
│                                                              │
│  Brief ──► Hooks ──► Caption ──► Script ──► Titles           │
│              │          │            │           │           │
│              ▼          ▼            ▼           ▼           │
│        PREFER_ON_  PREFER_ON_  ONLY_IN_   ONLY_IN_           │
│        DEVICE      DEVICE      CLOUD      CLOUD              │
│              │          │            │           │           │
│              ▼          ▼            ▼           ▼           │
│        Gemini Nano  Gemini Nano  gemini-3.5- gemini-3.5-     │
│        (Chrome)     (Chrome)     flash-lite flash-lite       │
│              │          │            │           │           │
│              └────┬─────┘            └─────┬─────┘           │
│                   ▼  fallback              ▼                 │
│           gemini-3.5-flash-lite   fallback: gemini-3.8-flash │
│                                                              │
│  Every response reports response.inferenceSource ──► routing │
│  panel (task, model, latency, reason).                       │
│                                                              │
│  Firebase: AI Logic (Gemini Developer API) · App Check ·     │
│  Anonymous Auth · Firestore (projects collection)            │
└──────────────────────────────────────────────────────────────┘
```

## Project structure

```
├── index.html            # App shell
├── src/
│   ├── main.js           # UI wiring, tabs, routing log, save/load
│   ├── firebase.js       # Firebase init (env config, App Check, Auth, AI)
│   ├── ai.js             # Hybrid inference: modes, models, inferenceSource
│   ├── prompts.js        # Prompt builders + Schema definitions
│   ├── store.js          # Firestore + localStorage project persistence
│   ├── demo.js           # Clearly-labelled sample output (demo mode only)
│   └── styles.css        # Dark creator-studio theme
├── firestore.rules       # Per-user project access rules
├── firebase.json         # Firebase Hosting config
├── tests/
│   ├── live-cloud-checks.py         # 36-check live suite (Playwright/Firefox)
│   └── live-cloud-checks-report.json # Latest run result (36/36, 24 Nov 2026)
├── .env.example          # Required config (copy to .env)
└── LICENSE               # Apache 2.0
```

## Setup

### 1. Create a Firebase project

1. In the [Firebase console](https://console.firebase.google.com), create a
   project (or add Firebase to an existing Google Cloud project).
2. Go to **AI Services > AI Logic**, click **Get started**, and choose the
   **Gemini Developer API** as the provider (free tier, no billing needed).
   The guided setup enables the required APIs and enforces App Check.
3. Register a **Web app** and copy its config.
4. Enable **Authentication > Sign-in method > Anonymous**.
5. Create a **Firestore database** and deploy `firestore.rules`
   (`firebase deploy --only firestore:rules`), or paste the rules in the console.
6. For App Check on the hosted demo, either add a **reCAPTCHA v3** site key
   (set `VITE_RECAPTCHA_V3_SITE_KEY`) or use the **debug provider**: run the
   app once, copy the debug token printed in the browser console, and register
   it under **App Check > Manage debug tokens**. Debug tokens are explicitly
   accepted for hackathon submissions.

### 2. Run locally

```bash
npm install
cp .env.example .env   # fill in your Firebase web config
npm run dev            # http://localhost:5173
```

Without a `.env`, the app runs in **demo mode** with sample output.

### 3. Build & deploy

```bash
npm run build          # -> dist/
firebase deploy --only hosting   # or deploy dist/ to any static host
```

## Testing instructions (for judges)

### Fastest path — demo mode (no setup)

Open the hosted app with no Firebase config and click **Generate full
package**. Every result is labelled **SAMPLE**, and the routing log records
"Demo mode — no inference ran". This previews the full UX and routing UI.

### Full path — live hybrid inference

Requirements: **Chrome 139+ on desktop**.

1. Enable the on-device model flag and restart Chrome:
   `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` → Enabled.
2. (Optional) Pre-download the model in DevTools console:
   `await LanguageModel.create()` — or let the first generation download it;
   the app shows download progress.
3. Open the app, enter a topic, click **Generate full package**.
4. Watch the **Hybrid routing** panel: Hooks and Caption should show
   **On-device · Gemini Nano** (after the one-time download); Script and
   Titles show **Cloud · Gemini** with real latencies.
5. Try the routing switch: **Cloud only** forces everything to Gemini;
   **On-device first** tries Nano for every task.
6. Try it offline (DevTools > Network > Offline, then reload): hooks and
   captions still generate on-device; cloud tasks fail honestly with a
   message that says so.
7. Save a project, reload, and load it back from **Saved projects**.

## What was verified

- `npm run build` passes; the production bundle serves and renders (smoke-tested
  with Playwright/Firefox + curl).
- All Firebase AI Logic API usage was verified against the official docs **and**
  the installed SDK (`firebase@13.4.0`): `getAI`, `GoogleAIBackend`,
  `getGenerativeModel` with `InferenceMode`, `inCloudParams` /
  `onDeviceParams`, `initializeDeviceModel`, `response.inferenceSource`, and
  the `Schema` helpers.
- Cloud model names are documented stable models (`gemini-3.5-flash-lite`
  primary, `gemini-3.8-flash` fallback), with a one-time retry on the
  alternate model if a name ever 404s or the backend returns a 5xx. Live
  testing on 21 Nov 2026 showed `gemini-3.8-flash` returning HTTP 500/503
  on the Gemini Developer API backend, so lite is the primary cloud model.

- Live cloud generation verified end-to-end against a real Firebase
  project (Playwright/Firefox, 21 Nov 2026): all 4 tasks succeed in the
  cloud with real, on-topic content; the routing log shows `IN_CLOUD` with
  real latencies (avg ~1.7s per task, 8.3s for the full package); zero
  console errors and zero failed requests.
- Firestore save/load verified against the live database (21 Nov 2026): a
  project saved under anonymous Auth, survived a page reload, and loaded
  back with its full content; the document exists in the `projects`
  collection under the user's uid.

### Not verified (needs a real Firebase project + Chrome)

- The on-device Gemini Nano path end-to-end (needs Chrome 139+ with the model
  downloaded — not available in this build environment).

## Live cloud tests

`tests/live-cloud-checks.py` is a 36-check Playwright/Firefox suite that runs
against the live hosted demo — no local Firebase config needed. It covers:
page load in configured mode, full-package generation of all 4 tasks, routing
honesty (real `inferenceSource`, latencies, model names), content completeness
(5 hooks, caption + hashtags, 5 scenes, 4 titles + 4 thumbnail texts), and the
Firestore save/reload/load round-trip.

```bash
pip install playwright
playwright install firefox
python3 tests/live-cloud-checks.py   # writes tests/live-cloud-checks-report.json
```

Results: the first live run (21 Nov 2026) passed 35/36 — the one failure was a
case-sensitivity bug in the test script's own assertion (the badges read
"Cloud · Gemini" / "In cloud" in the DOM, but CSS uppercases them visually),
not an app bug. The suite was rebuilt with case-insensitive assertions and
re-ran **36/36 on 24 Nov 2026** (report in
`tests/live-cloud-checks-report.json`). Note: the Gemini backend occasionally
returns HTTP 500 ("high demand") or 429 during demand spikes; the app retries
across models and surfaces an honest error, and the suite retries the package
once before failing.

## License

Apache 2.0 — see [LICENSE](LICENSE).
