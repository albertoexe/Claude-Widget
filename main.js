'use strict'

/**
 * main.js — Electron main process
 *
 * M3 additions: system tray + dynamic PNG icons, always-on-top re-assertion,
 * desktop notifications, compact mode, settings IPC side-effects,
 * launch-at-startup (Windows), dynamic window height.
 */

const {
  app, BrowserWindow, ipcMain, safeStorage,
  Tray, Menu, Notification, nativeImage
} = require('electron')
const path = require('path')
const fs   = require('fs')
const os   = require('os')
const zlib = require('zlib')
const Store = require('electron-store')
const { fetchViaWindow } = require('./src/fetch-via-window')

// ── Constants ─────────────────────────────────────────────────────────────────
const CLAUDE_BASE         = 'https://claude.ai'
const SESSION_COOKIE_NAME = 'sessionKey'
const PARTITION           = 'persist:claude'
const STATS_PATH          = path.join(os.homedir(), '.claude', 'stats-cache.json')

// Named window sizes
const WIN = {
  login:    { width: 460, height: 420 },
  widget:   { width: 680, height: 460 },
  compact:  { width: 560, height: 140 },
  settings: { width: 720, height: 560 }
}

const ALLOWED_LOGIN_HOSTS = [
  'claude.ai', 'accounts.google.com', 'appleid.apple.com', 'login.microsoftonline.com'
]

// ── Store ─────────────────────────────────────────────────────────────────────
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
let tray              = null
let refreshTimer      = null
let lastNotified      = {}   // { session: 'warn'|'danger'|'ok', weekly: same }
let settingsPanelOpen = false
let resizeSession     = null
let viewMinimum       = { ...WIN.login }
let currentMinimum    = { ...WIN.login }

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
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch (e) {
    console.error('[auth] Decrypt failed:', e.message)
    return null
  }
}

function clearCredentials () { store.delete('credentials') }

// ── Org helpers ───────────────────────────────────────────────────────────────

async function discoverOrgs () {
  const data = await fetchViaWindow(`${CLAUDE_BASE}/api/organizations`)
  return Array.isArray(data) ? data : []
}

function pickOrg (orgs) {
  const chatOrgs = orgs.filter(o => o.capabilities?.chat === true)
  const pool     = chatOrgs.length ? chatOrgs : orgs
  const team     = pool.find(o => !o.name?.toLowerCase().includes('personal'))
  const org      = team || pool[0]
  return { ...org, _uuid: org.uuid ?? org.id }
}

// ── Local stats (stats-cache.json) ────────────────────────────────────────────

function readLocalStats () {
  try {
    return computeLocalMetrics(JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')))
  } catch { return null }
}

function formatModelName (key) {
  return String(key || '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d)-(\d)\b/g, ' $1.$2')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function totalModelTokens (usage = {}) {
  return (usage.inputTokens || 0) +
    (usage.outputTokens || 0) +
    (usage.cacheReadInputTokens || 0) +
    (usage.cacheCreationInputTokens || 0)
}

function computeLocalMetrics (data) {
  const today = new Date().toISOString().split('T')[0]
  const days = [...(data.dailyModelTokens || [])].sort((a, b) => a.date.localeCompare(b.date))
  const modelUsage = data.modelUsage || {}

  const sumTokens = (entries) =>
    entries.reduce((acc, entry) => acc + Object.values(entry.tokensByModel || {}).reduce((inner, value) => inner + value, 0), 0)

  const last = (n) => {
    const cutoff = new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0]
    return days.filter((entry) => entry.date >= cutoff)
  }

  const modelBreakdown = Object.entries(modelUsage)
    .map(([key, usage]) => ({
      key,
      label: formatModelName(key),
      totalTokens: totalModelTokens(usage),
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      cacheReadInputTokens: usage.cacheReadInputTokens || 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens || 0
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)

  return {
    todayTokens: sumTokens(days.filter((entry) => entry.date === today)),
    weeklyTokens: sumTokens(last(7)),
    monthlyTokens: sumTokens(last(30)),
    allTimeTokens: modelBreakdown.reduce((acc, item) => acc + item.totalTokens, 0),
    modelBreakdown,
    history: days.slice(-30).map((entry) => ({ date: entry.date, tokens: sumTokens([entry]) })),
    firstSessionDate: data.firstSessionDate || null
  }
}

// Usage API ─────────────────────────────────────────────────────────────────

async function fetchUsage (orgId) {
  return fetchViaWindow(`${CLAUDE_BASE}/api/organizations/${orgId}/usage`)
}

/** Confirmed field names 2026-05-16: five_hour, seven_day, seven_day_omelette */
function parseApiUsage (raw) {
  const session  = raw.five_hour          ?? null
  const weekly   = raw.seven_day          ?? null
  const modelSub = raw.seven_day_omelette ?? null

  return {
    sessionPct:      session?.utilization  ?? null,
    weeklyPct:       weekly?.utilization   ?? null,
    modelSubPct:     modelSub?.utilization ?? null,
    sessionResetsAt: session?.resets_at    ?? null,
    weeklyResetsAt:  weekly?.resets_at     ?? null
  }
}

// ── Refresh loop ──────────────────────────────────────────────────────────────

function startRefreshLoop () {
  stopRefreshLoop()
  doRefresh()
  refreshTimer = setInterval(doRefresh, (store.get('refreshInterval') || 5) * 60_000)
}

function stopRefreshLoop () {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null }
}

async function doRefresh () {
  const orgId = store.get('selectedOrgId')
  if (!orgId) return

  try {
    const [rawApi, local] = await Promise.all([
      fetchUsage(orgId),
      Promise.resolve(readLocalStats())
    ])

    if (rawApi?.type === 'error') {
      throw new Error(`API error: ${rawApi.error?.message ?? JSON.stringify(rawApi.error)}`)
    }

    const api = parseApiUsage(rawApi)
    console.log('[data] Session:', api.sessionPct?.toFixed(1), '%  Weekly:', api.weeklyPct?.toFixed(1), '%')

    mainWindow?.webContents.send('usage:push', { api, local, lastUpdated: new Date().toISOString() })

    updateTrayIcon(api.sessionPct, api.weeklyPct)
    checkNotifications(api)
  } catch (e) {
    console.error('[data] Refresh failed:', e.message)
    if (/(401|403|session|expired|cloudflare)/i.test(e.message)) {
      stopRefreshLoop()
      settingsPanelOpen = false
      store.delete('selectedOrgId')
      updateTrayMenu()
      mainWindow?.webContents.send('auth:expired')
    }
  }
}

// ── PNG generator (no external deps) ─────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32 (buf) {
  let c = 0xFFFFFFFF
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)) >>> 0
  return (c ^ 0xFFFFFFFF) >>> 0
}

function pngChunk (type, data) {
  const t = Buffer.from(type, 'ascii')
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const len = Buffer.alloc(4); len.writeUInt32BE(d.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, d])))
  return Buffer.concat([len, t, d, crc])
}

function makePng (w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6  // 8-bit RGBA

  const stride = w * 4
  const raw    = Buffer.alloc(h * (1 + stride))
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0   // filter: None
    rgba.copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

// ── Tray icon ─────────────────────────────────────────────────────────────────
//
// 20×20 px. Split into two vertical "battery" bars:
//   Left  9px: session %  (purple → amber → red)
//   Right 9px: weekly  %  (sky    → amber → red)
//   Middle 2px: dark separator

function buildTrayIcon (sessionPct, weeklyPct) {
  const SIZE = 20
  const BAR  = 9
  const warn   = store.get('warnThreshold')   ?? 70
  const danger = store.get('dangerThreshold') ?? 90

  function barColor (pct, dflt) {
    if (pct == null)    return [40, 40, 60, 180]
    if (pct >= danger)  return [220, 38, 38, 255]
    if (pct >= warn)    return [217, 119, 6, 255]
    return dflt
  }

  const sc = barColor(sessionPct, [124, 58, 237, 255])
  const wc = barColor(weeklyPct,  [14, 165, 233, 255])

  const rgba = Buffer.alloc(SIZE * SIZE * 4, 0)

  function paintBar (xStart, width, pct, color) {
    const filled = pct != null ? Math.round((Math.min(100, Math.max(0, pct)) / 100) * SIZE) : 0
    for (let y = 0; y < SIZE; y++) {
      for (let x = xStart; x < xStart + width; x++) {
        const i = (y * SIZE + x) * 4
        if (y >= SIZE - filled) {
          rgba[i] = color[0]; rgba[i+1] = color[1]
          rgba[i+2] = color[2]; rgba[i+3] = color[3]
        } else {
          rgba[i] = 22; rgba[i+1] = 22; rgba[i+2] = 38; rgba[i+3] = 220
        }
      }
    }
  }

  paintBar(0,          BAR, sessionPct, sc)
  paintBar(SIZE - BAR, BAR, weeklyPct,  wc)

  return nativeImage.createFromBuffer(makePng(SIZE, SIZE, rgba), { scaleFactor: 1.0 })
}

// ── Tray setup ────────────────────────────────────────────────────────────────

function showMainWindow () {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.show()
  mainWindow.focus()
}

function openSettingsPanel () {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (!store.get('selectedOrgId')) {
    showMainWindow()
    return
  }

  settingsPanelOpen = true
  showMainWindow()
  resizeMainWindow('settings')
  mainWindow.webContents.send('settings:show')
}

function closeSettingsPanel () {
  settingsPanelOpen = false
  if (!mainWindow || mainWindow.isDestroyed()) return
  resizeMainWindow(currentWidgetSize())
}

function setupTray () {
  tray = new Tray(buildTrayIcon(null, null))
  tray.setToolTip('Claude Widget')
  updateTrayMenu()

  tray.on('click', () => {
    if (!mainWindow) return
    mainWindow.isVisible() ? mainWindow.hide() : showMainWindow()
  })
}

function updateTrayMenu () {
  if (!tray) return

  const authenticated = Boolean(store.get('selectedOrgId'))

  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show / Hide',
      click: () => {
        if (!mainWindow) return
        mainWindow.isVisible() ? mainWindow.hide() : showMainWindow()
      }
    },
    { type: 'separator' },
    { label: 'Refresh now', enabled: authenticated, click: () => doRefresh() },
    { label: 'Settings', enabled: authenticated, click: () => openSettingsPanel() },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: store.get('alwaysOnTop'),
      click: (item) => {
        store.set('alwaysOnTop', item.checked)
        mainWindow?.setAlwaysOnTop(item.checked)
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { stopRefreshLoop(); app.quit() } }
  ]))
}

function updateTrayIcon (sessionPct, weeklyPct) {
  if (!tray) return
  tray.setImage(buildTrayIcon(sessionPct, weeklyPct))
  const s = sessionPct != null ? `${sessionPct.toFixed(0)}%` : '—'
  const w = weeklyPct  != null ? `${weeklyPct.toFixed(0)}%`  : '—'
  tray.setToolTip(`Claude Widget  ·  Session ${s}  ·  Weekly ${w}`)
}

// ── Notifications ─────────────────────────────────────────────────────────────

function checkNotifications (api) {
  if (!store.get('notifications')) return
  if (typeof Notification.isSupported === 'function' && !Notification.isSupported()) return
  const warn   = store.get('warnThreshold')   ?? 70
  const danger = store.get('dangerThreshold') ?? 90

  function maybeNotify (key, pct, label) {
    if (pct == null) return
    const level = pct >= danger ? 'danger' : pct >= warn ? 'warn' : 'ok'
    if (lastNotified[key] === level) return
    lastNotified[key] = level
    if (level === 'ok') return
    new Notification({
      title: 'Claude Widget',
      body:  level === 'danger'
        ? `⚠️ ${label} at ${pct.toFixed(0)}% — almost full`
        : `🟡 ${label} at ${pct.toFixed(0)}%`,
      silent: false
    }).show()
  }

  maybeNotify('session', api.sessionPct, 'Session')
  maybeNotify('weekly',  api.weeklyPct,  'Weekly')
}

// ── Launch at startup (Windows only) ─────────────────────────────────────────

function syncLoginItem () {
  if (process.platform !== 'win32') return   // Windows only
  app.setLoginItemSettings({
    openAtLogin: !!store.get('launchAtStartup'),
    name:        'Claude Widget',
    path:        process.execPath
  })
}

// ── Window resize helpers ─────────────────────────────────────────────────────

function applyMinimumSize (width, height, options = {}) {
  if (options.updateViewMinimum) viewMinimum = { width, height }
  currentMinimum = { width, height }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setMinimumSize(width, height)
  }
}

function resizeMainWindow (viewName) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const dim = WIN[viewName]
  if (!dim) return

  applyMinimumSize(dim.width, dim.height, { updateViewMinimum: true })

  const [currentWidth, currentHeight] = mainWindow.getSize()
  const nextWidth = Math.max(currentWidth, dim.width)
  const nextHeight = Math.max(currentHeight, dim.height)

  if (nextWidth !== currentWidth || nextHeight !== currentHeight) {
    mainWindow.setSize(nextWidth, nextHeight, true)
  }
}

function currentWidgetSize () {
  return store.get('compactMode') ? 'compact' : 'widget'
}

// ── Auth flow ─────────────────────────────────────────────────────────────────

async function onSessionCaptured (sessionKey) {
  console.log('[auth] Session key captured — saving and validating')
  saveSessionKey(sessionKey)

  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.destroy(); loginWindow = null }
  mainWindow?.webContents.send('auth:validating')

  try {
    const orgs = await discoverOrgs()
    if (!orgs.length) throw new Error('No organisations returned')
    const org = pickOrg(orgs)
    store.set('selectedOrgId', org._uuid)
    console.log(`[auth] Org resolved: ${org.name} (uuid: ${org._uuid})`)
    resizeMainWindow(currentWidgetSize())
    mainWindow?.webContents.send('auth:success', { orgId: org._uuid, orgName: org.name })
    startRefreshLoop()
    updateTrayMenu()
  } catch (e) {
    console.error('[auth] Org discovery failed:', e.message)
    clearCredentials()
    settingsPanelOpen = false
    store.delete('selectedOrgId')
    updateTrayMenu()
    resizeMainWindow('login')
    mainWindow?.webContents.send('auth:expired')
  }
}

async function validateExistingSession () {
  const key = loadSessionKey()
  if (!key) {
    store.delete('selectedOrgId')
    updateTrayMenu()
    return false
  }
  try {
    const orgs = await discoverOrgs()
    if (!orgs.length) throw new Error('Empty org list')
    const org = pickOrg(orgs)
    store.set('selectedOrgId', org._uuid)
    console.log(`[auth] Org re-validated: ${org.name} (uuid: ${org._uuid})`)
    resizeMainWindow(currentWidgetSize())
    mainWindow?.webContents.send('auth:success', { orgId: org._uuid, orgName: org.name })
    startRefreshLoop()
    updateTrayMenu()
    return true
  } catch (e) {
    console.error('[auth] Existing session invalid:', e.message)
    clearCredentials()
    store.delete('selectedOrgId')
    updateTrayMenu()
    return false
  }
}

// ── Window factories ──────────────────────────────────────────────────────────

function createMainWindow () {
  const bounds = store.get('windowBounds')
  const initialWidth = Math.max(bounds.width ?? WIN.login.width, WIN.login.width)
  const initialHeight = Math.max(bounds.height ?? WIN.login.height, WIN.login.height)

  mainWindow = new BrowserWindow({
    width:       initialWidth,
    height:      initialHeight,
    minWidth:    WIN.login.width,
    minHeight:   WIN.login.height,
    x:           bounds.x ?? undefined,
    y:           bounds.y ?? undefined,
    frame:       false,
    transparent: false,
    backgroundColor: '#0f1220',
    alwaysOnTop: store.get('alwaysOnTop'),
    resizable:   true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox:          false,
      preload:          path.join(__dirname, 'preload.js')
    }
  })
  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'))
  applyMinimumSize(WIN.login.width, WIN.login.height, { updateViewMinimum: true })
  mainWindow.on('moved',  () => { if (mainWindow && !mainWindow.isDestroyed()) store.set('windowBounds', mainWindow.getBounds()) })
  mainWindow.on('resize', () => { if (mainWindow && !mainWindow.isDestroyed()) store.set('windowBounds', mainWindow.getBounds()) })
  mainWindow.on('closed', () => { stopRefreshLoop(); settingsPanelOpen = false; resizeSession = null; mainWindow = null })
}

function openLoginWindow () {
  if (loginWindow && !loginWindow.isDestroyed()) { loginWindow.focus(); return }
  loginWindow = new BrowserWindow({
    width: 500, height: 700, title: 'Sign in to Claude',
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: PARTITION, sandbox: true }
  })
  loginWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const host = new URL(url).hostname
      if (!ALLOWED_LOGIN_HOSTS.some(h => host === h || host.endsWith('.' + h))) { e.preventDefault() }
    } catch { e.preventDefault() }
  })
  loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const ses = loginWindow.webContents.session
  const cookieListener = (_e, cookie, _c, removed) => {
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
  ipcMain.on('auth:start',      ()      => openLoginWindow())
  ipcMain.on('auth:manual-key', (_e, k) => { if (typeof k === 'string' && k.length > 10) onSessionCaptured(k) })
  ipcMain.on('auth:logout',     ()      => {
    stopRefreshLoop(); clearCredentials(); store.delete('selectedOrgId')
    settingsPanelOpen = false
    lastNotified = {}
    resizeMainWindow('login')
    mainWindow?.webContents.send('auth:expired')
    updateTrayMenu()
  })

  // Usage
  ipcMain.on('usage:request', () => doRefresh())

  // Window controls
  ipcMain.on('window:minimize',    ()      => mainWindow?.hide())   // hide → tray
  ipcMain.on('window:close',       ()      => mainWindow?.hide())   // close → tray (quit via tray menu)
  ipcMain.on('window:alwaysOnTop', (_e, f) => { mainWindow?.setAlwaysOnTop(Boolean(f)); store.set('alwaysOnTop', Boolean(f)); updateTrayMenu() })
  ipcMain.on('window:setHeight',   (_e, h) => {
    if (!mainWindow || mainWindow.isDestroyed()) return

    const targetHeight = Math.max(viewMinimum.height, Math.min(1600, Math.round(h)))
    applyMinimumSize(viewMinimum.width, targetHeight)

    const [currentWidth, currentHeight] = mainWindow.getSize()
    if (currentHeight < targetHeight) {
      mainWindow.setSize(currentWidth, targetHeight, true)
    }
  })

  ipcMain.on('window:resize-start', (_e, payload) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    resizeSession = {
      startX: Number(payload?.screenX) || 0,
      startY: Number(payload?.screenY) || 0,
      bounds: mainWindow.getBounds()
    }
  })

  ipcMain.on('window:resize-move', (_e, payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || !resizeSession) return

    const screenX = Number(payload?.screenX) || resizeSession.startX
    const screenY = Number(payload?.screenY) || resizeSession.startY
    const deltaX = screenX - resizeSession.startX
    const deltaY = screenY - resizeSession.startY

    const width = Math.max(currentMinimum.width, resizeSession.bounds.width + deltaX)
    const height = Math.max(currentMinimum.height, resizeSession.bounds.height + deltaY)

    mainWindow.setBounds({
      x: resizeSession.bounds.x,
      y: resizeSession.bounds.y,
      width: Math.round(width),
      height: Math.round(height)
    })
  })

  ipcMain.on('window:resize-end', () => {
    resizeSession = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds())
    }
  })

  // Compact mode
  ipcMain.on('compact:toggle', () => {
    const next = !store.get('compactMode')
    store.set('compactMode', next)
    if (!settingsPanelOpen) resizeMainWindow(next ? 'compact' : 'widget')
    mainWindow?.webContents.send('compact:change', next)
  })

  // Settings panel open/close
  ipcMain.on('settings:open',  () => openSettingsPanel())
  ipcMain.on('settings:close', () => closeSettingsPanel())

  // Settings read/write
  ipcMain.on('settings:get',  (e)     => e.reply('settings:response', store.store))
  ipcMain.on('settings:save', (_e, p) => {
    if (!p || typeof p !== 'object') return

    Object.entries(p).forEach(([key, value]) => store.set(key, value))

    if ('launchAtStartup' in p) syncLoginItem()
    if ('refreshInterval' in p) { stopRefreshLoop(); startRefreshLoop() }
    if ('alwaysOnTop' in p) {
      mainWindow?.setAlwaysOnTop(Boolean(p.alwaysOnTop))
      updateTrayMenu()
    }
    if ('compactMode' in p) {
      const next = Boolean(p.compactMode)
      if (!settingsPanelOpen) resizeMainWindow(next ? 'compact' : 'widget')
      mainWindow?.webContents.send('compact:change', next)
    }
    if ('notifications' in p && !p.notifications) lastNotified = {}

    mainWindow?.webContents.send('settings:response', store.store)
  })
}

// App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerIPC()
  createMainWindow()
  setupTray()
  syncLoginItem()

  // Re-assert always-on-top every 5 s (some full-screen apps knock us off)
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed() && store.get('alwaysOnTop')) {
      mainWindow.setAlwaysOnTop(true)
    }
  }, 5000)

  setTimeout(async () => {
    mainWindow?.webContents.send('auth:validating')
    const valid = await validateExistingSession()
    if (!valid) {
      resizeMainWindow('login')
      mainWindow?.webContents.send('auth:needed')
    }
  }, 600)
})

// Stay alive in tray — quit only from tray menu
app.on('window-all-closed', () => { /* intentional no-op */ })
app.on('activate', () => { if (mainWindow) mainWindow.show() })
app.on('before-quit', () => stopRefreshLoop())
