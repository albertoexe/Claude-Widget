# Claude Widget — Agent Context

Full project context lives in the vault:

- **AGENTS.md (vault):** `C:\Users\AlbertoDeCol\Il mio Drive\Second Brain\Second Brain\playground\Claude Widget\AGENTS.md`
- **Build Plan:** `C:\Users\AlbertoDeCol\Il mio Drive\Second Brain\Second Brain\playground\Claude Widget\00 Planning\Build Plan.md`
- **PRD:** `C:\Users\AlbertoDeCol\Il mio Drive\Second Brain\Second Brain\playground\Claude Widget\00 Planning\PRD.md`

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Electron 28 (vanilla JS — no bundler) |
| Auth | Cookie capture via visible BrowserWindow |
| Credential storage | `safeStorage` (DPAPI on Windows, Keychain on macOS) + `electron-store` |
| API transport | `src/fetch-via-window.js` — hidden BrowserWindow carrying session cookies |
| UI | Plain HTML + CSS + JS (no framework) |
| Charts | chart.js vendored → `src/renderer/vendor/chart.umd.js` (M3) |
| Distribution | electron-builder NSIS (Windows) + DMG (macOS) |

## File map

```
claude-widget/
├── main.js                        ← main process (IPC, windows, auth, store)
├── preload.js                     ← contextBridge — all IPC exposed to renderer
├── src/
│   ├── fetch-via-window.js        ← hidden BrowserWindow fetcher
│   └── renderer/
│       ├── index.html             ← widget shell + CSP header
│       ├── app.js                 ← all UI logic
│       ├── styles.css             ← dark / light themes
│       └── vendor/
│           └── chart.umd.js      ← vendored chart.js (added in M3)
├── assets/                        ← icons (icon.png, tray-win.ico, tray-mac.png)
├── package.json
├── .gitignore
├── README.md
├── AGENTS.md                      ← you are here
└── CLAUDE.md
```

## Current milestone: M1 — Shell + auth

**Exit criterion:** login works end-to-end; sessionKey captured, encrypted, stored; org resolved via API.

### IPC channels (M1)

| Channel | Direction | Payload |
|---------|-----------|---------|
| `auth:start` | renderer → main | — |
| `auth:manual-key` | renderer → main | `string` |
| `auth:logout` | renderer → main | — |
| `auth:needed` | main → renderer | — |
| `auth:validating` | main → renderer | — |
| `auth:success` | main → renderer | `{ orgId, orgName }` |
| `auth:expired` | main → renderer | — |
| `window:minimize` | renderer → main | — |
| `window:close` | renderer → main | — |
| `window:alwaysOnTop` | renderer → main | `bool` |
| `settings:get` | renderer → main | — |
| `settings:response` | main → renderer | settings object |
| `settings:save` | renderer → main | patch object |

## Rules

- CommonJS (`require`) throughout — no ESM, no bundler, no transpile step
- `(C)` prefix on all AI-generated files
- Ask before editing files **without** the `(C)` prefix
- Flag OS-specific code with `// Windows only` or `// macOS only`
- After each dev session: drop a log entry in the vault under `playground/Claude Widget/02 Iteration Logs/`
- No feature creep mid-session — log new ideas in vault `00 Planning/`, finish current task first
