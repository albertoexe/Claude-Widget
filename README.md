# Claude Widget

Always-on-top Electron widget showing live Claude.ai usage: session %, weekly %, monthly tokens, and per-model breakdown.

Built from scratch by Alberto — zero code from the reference repo ([SlavomirDurej/claude-usage-widget](https://github.com/SlavomirDurej/claude-usage-widget)).

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Electron 28 (vanilla JS — no bundler) |
| Auth | Cookie capture via visible BrowserWindow |
| Credential storage | `safeStorage` + `electron-store` |
| API transport | `fetch-via-window.js` (hidden BrowserWindow, session cookies) |
| UI | Plain HTML + CSS + JS |
| Charts | chart.js vendored (added in M3) |
| Distribution | electron-builder (NSIS + DMG) |

## Dev

```bash
npm install
npm run dev
```

## Build

```bash
npm run build:win   # → dist/ NSIS installer (Windows)
npm run build:mac   # → dist/ DMG (macOS)
```

## Milestones

| # | Name | Status |
|---|------|--------|
| M0 | Planning | ✅ |
| M1 | Shell + auth | 🔨 |
| M2 | Data + bare UI | ⬜ |
| M3 | Full UX | ⬜ |
| M4 | Package | ⬜ |
