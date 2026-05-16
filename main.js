'use strict'

/**
 * main.js — Electron main process
 *
 * M2 additions: usage API polling, local stats-cache.json reader,
 * usage:push → renderer, window resize per view.
 */

const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const Store = require('electron-store')
const { fetchViaWindow } = require('./src/fetch-via-window')

// ── Constants ─────────────────────────────────────────────────────────────────
const CLAUDE_BASE        = 'https://claude.ai'
const SESSION_COOKIE_NAME = 'sessionKey'
const PARTITION          = 'persist:claude'
const STATS_PATH         = path.join(os.homedir(), '.claude', 'stats-cache.json')

// Window dimensions
const WIN = {
  login:  { width: 420, height: 380 },
  widget: { width: 560, height: 185 }
}

// Login window: restrict navigation to known auth providers only
const ALLOWED_LOGIN_HOSTS = [
  'claude.ai',
  'accounts.google.com',
  'appleid.apple.com',
  'login.microsoftonline.com'
]

// ── Store (settings + encrypted credentials) ──────────────────────────────────
const store = new Store({
  defaults: {
    refreshInterval: 5,
    alwaysOnTop:     true,
    theme:           'system',
    compactMode:     false,
    warnThreshold:   70,
    dangerThreshold: 90,
    notifications:   true,
    launchAtStartup: false,
    selectedOrgId:   null,
    windowBounds:    { x: null, y: null, ...WIN.login },
    showGraph:       false,
    isExpanded:      false,
    timeFormat:      '12h',
    dateFormat:      'short'
  }
})

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow   = null
let loginWindow  = null
let refreshTimer = null

// ── Credential helpers ────────────────────────────────────────────────────────

function saveSessionKey (key) {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[auth] safeStorage unavailable — storing unencrypted (dev only)')
    store.set('credentials.sessionKeyEncrypted', key)
    store.set('credentials.plain', true)
    return
  }
  const encrypted = safeStorage.encryptString(key)
  store.set('credentials.sessionKeyEncrypted', encrypted.toString('base64'))
  store.set('credentials.plain', false)
}

function loadSessionKey () {
  const enc = store.get('credentials.sessionKeyEncrypted')
  if (!enc) return null
  if (store.get('credentials.plain')) return enc
  try {
    const buf = Buffer.from(enc, 'base64')
    return safeStorage.decryptString(buf)
  } catch (e) {
    console.error('[auth] Decrypt failed:', e.message)
    return null
  }
}

function clearCredentials () {
  store.delete('credentials')
}

// ── Org helpers ───────────────────────────────────────────────────────────────

async function discoverOrgs () {
  const data = await fetchViaWindow(`${CLAUDE_BASE}/api/organizations`)
  return Array.isArray(data) ? data : []
}

/** Prefer team org (capabilities.chat = true, non-personal) over personal */
function pickOrg (orgs) {
  const chatOrgs = orgs.filter(o => o.capabilities?.chat === true)
  const pool     = chatOrgs.length ? chatOrgs : orgs
  const team     = pool.find(o => !o.name?.toLowerCase().includes('personal'))
  const org      = team || pool[0]
  // Normalise: usage endpoint requires the full UUID, not the short `id`
  return { ...org, _uuid: org.uuid ?? org.id }
}

// ── Local stats (stats-cache.json) ────────────────────────────────────────────

function readLocalStats () {
  try {
    const raw  = fs.readFileSync(STATS_PATH, 'utf8')
    const data = JSON.parse(raw)
    return computeLocalMetrics(data)
  } catch {
    return null   // graceful — widget still works on API data alone
  }
}

function computeLocalMetrics (data) {
  const today = new Date().toISOString().split('T')[0]
  const days  = data.dailyModelTokens || []

  const sumTokens = (entries) =>
    entries.reduce((acc, e) => {
      const byModel = e.tokensByModel || {}
      return acc + Object.values(byModel).reduce((a, b) => a + b, 0)
    }, 0)

  const last = (n) => {
    const cutoff = new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0]
    return days.filter(e => e.date >= cutoff)
  }

  return {
    todayTokens:    sumTokens(days.filter(e => e.date === today)),
    weeklyTokens:   sumTokens(last(7)),
    monthlyTokens:  sumTokens(last(30)),
    modelBreakdown: data.modelUsage || {},
    history:        days.slice(-30).map(e => ({ date: e.date, tokens: sumTokens([e]) }))
  }
}

// ── Usage API ─────────────────────────────────────────────────────────────────

async function fetchUsage (orgId) {
  return fetchViaWindow(`${CLAUDE_BASE}/api/organizations/${orgId}/usage`)
}

/**
 * Normalise the claude.ai usage API response into a stable shape.
 * The exact field names are learned from the first live run (OQ4).
 * We try multiple paths so we degrade gracefully if the shape changes.
 */
function parseApiUsage (raw) {
  // Possible containers for session / weekly limits
  const session = raw.session_message_limit ?? raw.session ?? null
  const weekly  = raw.weekly_message_limit  ?? raw.weekly  ?? null

  function toPct (obj) {
    if (obj == null)                               return null
    if (typeof obj === 'number')                   return obj            // already %
    if (obj.percent    != null)                    return obj.percent
    if (obj.used       != null && obj.total != null) return (obj.used / obj.total) * 100
    if (obj.remaining  != null && obj.total != null)
      return ((obj.total - obj.remaining) / obj.total) * 100
    return null
  }

  return {
    sessionPct:      toPct(session),
    weeklyPct:       toPct(weekly),
    sessionResetsAt: session?.resets_at ?? null,
    weeklyResetsAt:  weekly?.resets_at  ?? null,
    _raw:            raw   // keep for debugging until we confirm the shape
  }
}

// ── Refresh loop ──────────────────────────────────────────────────────────────

function startRefreshLoop () {
  stopRefreshLoop()
  doRefresh()                                          // immediate first fetch
  const ms = (store.get('refreshInterval') || 5) * 60 * 1000
  refreshTimer = setInterval(doRefresh, ms)
}

function stopRefreshLoop () {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
}

async function doRefresh () {
  const orgId = store.get('selectedOrgId')
  if (!orgId) return

  try {
    const [rawApi, local] = await Promise.all([
      fetchUsage(orgId),
      Promise.resolve(readLocalStats())
    ])

    // Detect API-level error responses before trying to parse
    if (rawApi?.type === 'error') {
      throw new Error(`API error: ${rawApi.error?.message ?? JSON.stringify(rawApi.error)}`)
    }

    // ── TEMP DEBUG — remove once usage field names confirmed ──────────────
    console.log('[data] raw API keys:', Object.keys(rawApi))
    console.log('[data] raw API:', JSON.stringify(rawApi, null, 2))
    // ─────────────────────────────────────────────────────────────────────

    const api = parseApiUsage(rawApi)
    console.log('[data] Session:', api.sessionPct?.toFixed(1), '%  Weekly:', api.weeklyPct?.toFixed(1), '%')

    mainWindow?.webContents.send('usage:push', {
      api,
      local,
      lastUpdated: new Date().toISOString()
    })
  } catch (e) {
    console.error('[data] Refresh failed:', e.message)
    // Treat auth failure as session expiry
    if (/(401|403|session|expired|cloudflare)/i.test(e.message)) {
      stopRefreshLoop()
      mainWindow?.webContents.send('auth:expired')
    }
  }
}

// ── Window helpers ────────────────────────────────────────────────────────────

/** Animate the main window to the dimensions for a given view */
function resizeMainWindow (viewName) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const dim = WIN[viewName]
  if (!dim) return
  mainWindow.setSize(dim.width, dim.height, true)   // true = animate on macOS
}

// ── Auth flow ─────────────────────────────────────────────────────────────────

async function onSessionCaptured (sessionKey) {
  console.log('[auth] Session key captured — saving and validating')
  saveSessionKey(sessionKey)

  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.destroy()
    loginWindow = null
  }

  mainWindow?.webContents.send('auth:validating')

  try {
    const orgs = await discoverOrgs()
    if (!orgs.length) throw new Error('No organisations returned')

    const org = pickOrg(orgs)
    store.set('selectedOrgId', org._uuid)
    console.log(`[auth] Org resolved: ${org.name} (uuid: ${org._uuid})`)

    resizeMainWindow('widget')
    mainWindow?.webContents.send('auth:success', { orgId: org._uuid, orgName: org.name })
    startRefreshLoop()
  } catch (e) {
    console.error('[auth] Org discovery failed:', e.message)
    clearCredentials()
    resizeMainWindow('login')
    mainWindow?.webContents.send('auth:expired')
  }
}

async function validateExistingSession () {
  const key = loadSessionKey()
  if (!key) return false

  try {
    const orgs = await discoverOrgs()
    if (!orgs.length) throw new Error('Empty org list')

    const org = pickOrg(orgs)
    store.set('selectedOrgId', org._uuid)
    console.log(`[auth] Org re-validated: ${org.name} (uuid: ${org._uuid})`)

    resizeMainWindow('widget')
    mainWindow?.webContents.send('auth:success', { orgId: org._uuid, orgName: org.name })
    startRefreshLoop()
    return true
  } catch (e) {
    console.error('[auth] Existing session invalid:', e.message)
    clearCredentials()
    return false
  }
}

// ── Window factories ──────────────────────────────────────────────────────────

function createMainWindow () {
  const bounds = store.get('windowBounds')

  mainWindow = new BrowserWindow({
    width:       bounds.width,
    height:      bounds.height,
    x:           bounds.x ?? undefined,
    y:           bounds.y ?? undefined,
    frame:       false,
    transparent: false,
    alwaysOnTop: store.get('alwaysOnTop'),
    resizable:   false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload:          path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'))

  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds())
    }
  })

  mainWindow.on('closed', () => {
    stopRefreshLoop()
    mainWindow = null
  })
}

function openLoginWindow () {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }

  loginWindow = new BrowserWindow({
    width:  500,
    height: 700,
    title:  'Sign in to Claude',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      partition:        PARTITION,
      sandbox:          true
    }
  })

  loginWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const host    = new URL(url).hostname
      const allowed = ALLOWED_LOGIN_HOSTS.some(h => host === h || host.endsWith('.' + h))
      if (!allowed) { console.warn('[login] Blocked navigation to', url); e.preventDefault() }
    } catch { e.preventDefault() }
  })

  loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const ses = loginWindow.webContents.session
  const cookieListener = (_event, cookie, _cause, removed) => {
    if (!removed && cookie.name === SESSION_COOKIE_NAME && cookie.domain?.includes('claude.ai')) {
      ses.cookies.off('changed', cookieListener)
      onSessionCaptured(cookie.value)
    }
  }
  ses.cookies.on('changed', cookieListener)

  loginWindow.on('closed', () => { loginWindow = null })
  loginWindow.loadURL(`${CLAUDE_BASE}/login`)
}

// ── IPC handlers ──────────────────────────────────────────────────────────────

function registerIPC () {
  // Auth
  ipcMain.on('auth:start',      ()       => openLoginWindow())
  ipcMain.on('auth:manual-key', (_e, k)  => { if (typeof k === 'string' && k.length > 10) onSessionCaptured(k) })
  ipcMain.on('auth:logout',     ()       => {
    stopRefreshLoop()
    clearCredentials()
    store.delete('selectedOrgId')
    resizeMainWindow('login')
    mainWindow?.webContents.send('auth:expired')
  })

  // Usage
  ipcMain.on('usage:request', () => doRefresh())

  // Window controls
  ipcMain.on('window:minimize',   ()       => mainWindow?.minimize())
  ipcMain.on('window:close',      ()       => mainWindow?.close())
  ipcMain.on('window:alwaysOnTop',(_e, f)  => { mainWindow?.setAlwaysOnTop(Boolean(f)); store.set('alwaysOnTop', Boolean(f)) })

  // Settings
  ipcMain.on('settings:get',  (e)       => e.reply('settings:response', store.store))
  ipcMain.on('settings:save', (_e, p)   => { if (p && typeof p === 'object') Object.entries(p).forEach(([k, v]) => store.set(k, v)) })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerIPC()
  createMainWindow()

  setTimeout(async () => {
    mainWindow?.webContents.send('auth:validating')
    const valid = await validateExistingSession()
    if (!valid) {
      resizeMainWindow('login')
      mainWindow?.webContents.send('auth:needed')
    }
  }, 600)
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate',          () => { if (!mainWindow) createMainWindow() })
