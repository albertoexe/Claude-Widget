# Claude Widget

Always-on-top Electron widget showing live Claude.ai usage: session %, weekly %, monthly tokens, and per-model breakdown.

Built from scratch by Alberto - zero code from the reference repo ([SlavomirDurej/claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget)).

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Electron 28 (vanilla JS - no bundler) |
| Auth | Cookie capture via visible BrowserWindow |
| Credential storage | `safeStorage` + `electron-store` |
| API transport | `fetch-via-window.js` (hidden BrowserWindow, session cookies) |
| UI | Plain HTML + CSS + JS |
| Charts | chart.js vendored |
| Distribution | electron-builder (NSIS + DMG) |

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build:win        # Windows host -> NSIS x64 installer
npm run build:mac        # macOS host only -> DMG x64 + arm64
npm run build:mac:x64    # macOS host only
npm run build:mac:arm64  # macOS host only
```

## Status

| Milestone | Status |
|---|---|
| M0 - Planning | done |
| M1 - Shell + auth | done |
| M2 - Data + bare UI | done |
| M3 - Full UX | done |
| M4 - Package | in progress |
