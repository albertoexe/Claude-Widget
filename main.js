'use strict'

/**
 * main.js — Electron main process
 *
 * M1 scope: shell creation, login flow, cookie capture,
 * safeStorage credential handling, org discovery via fetch-via-window.
 */

const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const Store = require('electron-store')
const { fetchViaWindow } = require('./src/fetch-via-window')

// ── Constants ─────────────────────────────────────────────────────────────────
const CLAUDE_BASE = 'https://claude.ai'
const SESSION_COOKIE_NAME = 'sessionKey'
const PARTITION = 'persist:claude'

// Login window: restrict navigation to these auth providers only
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
    alwaysOnTop: true,
    theme: 'system',
    compactMode: false,
    warnThreshold: 70,
    dangerThreshold: 90,
    notifications: true,
    launchAtStartup: false,
    selectedOrgId: null,
    windowBounds: { x: null, y: null, width: 420, height: 380 },
    showGraph: false,
    isExpanded: false,
    timeFormat: '12h',
    dateFormat: 'short'
  }
})

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null
let loginWindow = null

// ── Credential helpers ────────────────────────────────────────────────────────

function saveSessionKey (key) {
  if (!safeStorage.isEncryptionAvailable()) {
    // Windows/macOS DPAPI not available (e.g. headless CI) — warn and store plain
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

/**
 * Pick the best org: prefer team orgs (capabilities.chat = true) over personal.
 * Falls back to first org if nothing better found.
 */
function pickOrg (orgs) {
  const chatOrgs = orgs.filter(o => o.capabilities?.chat === true)
  const pool = chatOrgs.length ? chatOrgs : orgs
  // Prefer non-personal
  const team = pool.find(o => !o.name?.toLowerCase().includes('personal'))
  return team || pool[0]
}

// ── Auth flow ─────────────────────────────────────────────────────────────────

/** Called once the sessionKey is in hand (auto-detect or manual) */
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
    store.set('selectedOrgId', org.id)
    console.log(`[auth] Org resolved: ${org.name} (${org.id})`)

    mainWindow?.webContents.send('auth:success', {
      orgId: org.id,
      orgName: org.name
    })
  } catch (e) {
    console.error('[auth] Org discovery failed:', e.message)
    clearCredentials()
    mainWindow?.webContents.send('auth:expired')
  }
}

/** Try to re-use existing stored credentials */
async function validateExistingSession () {
  const key = loadSessionKey()
  if (!key) return false

  try {
    const orgs = await discoverOrgs()
    if (!orgs.length) throw new Error('Empty org list')

    const org = pickOrg(orgs)
    store.set('selectedOrgId', org.id)

    mainWindow?.webContents.send('auth:success', {
      orgId: org.id,
      orgName: org.name
    })
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
    width: bounds.width,
    height: bounds.height,
    x: bounds.x ?? undefined,
    y: bounds.y ?? undefined,
    frame: false,
    transparent: false,
    alwaysOnTop: store.get('alwaysOnTop'),
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,              // needed for electron-store in preload-less pattern
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'))

  // Persist window position across restarts
  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      store.set('windowBounds', mainWindow.getBounds())
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

function openLoginWindow () {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus()
    return
  }

  loginWindow = new BrowserWindow({
    width: 500,
    height: 700,
    title: 'Sign in to Claude',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: PARTITION,   // must share partition with fetch-via-window
      sandbox: true
    }
  })

  // Restrict navigation — only allow known auth providers
  loginWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const host = new URL(url).hostname
      const allowed = ALLOWED_LOGIN_HOSTS.some(
        h => host === h || host.endsWith('.' + h)
      )
      if (!allowed) {
        console.warn('[login] Blocked navigation to', url)
        e.preventDefault()
      }
    } catch {
      e.preventDefault()
    }
  })

  // Block popups spawned by the login page
  loginWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // Listen for the sessionKey cookie on claude.ai
  const ses = loginWindow.webContents.session
  const cookieListener = (_event, cookie, _cause, removed) => {
    if (
      !removed &&
      cookie.name === SESSION_COOKIE_NAME &&
      cookie.domain?.includes('claude.ai')
    ) {
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
  ipcMain.on('auth:start', () => openLoginWindow())

  ipcMain.on('auth:manual-key', (_e, key) => {
    if (typeof key === 'string' && key.length > 10) {
      onSessionCaptured(key)
    }
  })

  ipcMain.on('auth:logout', () => {
    clearCredentials()
    store.delete('selectedOrgId')
    mainWindow?.webContents.send('auth:expired')
  })

  // Window controls
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.on('window:alwaysOnTop', (_e, flag) => {
    mainWindow?.setAlwaysOnTop(Boolean(flag))
    store.set('alwaysOnTop', Boolean(flag))
  })

  // Settings
  ipcMain.on('settings:get', (e) => {
    e.reply('settings:response', store.store)
  })
  ipcMain.on('settings:save', (_e, patch) => {
    if (patch && typeof patch === 'object') {
      Object.entries(patch).forEach(([k, v]) => store.set(k, v))
    }
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  registerIPC()
  createMainWindow()

  // Small delay so the renderer mounts before we push events
  setTimeout(async () => {
    mainWindow?.webContents.send('auth:validating')
    const valid = await validateExistingSession()
    if (!valid) {
      mainWindow?.webContents.send('auth:needed')
    }
  }, 600)
})

app.on('window-all-closed', () => {
  // macOS: keep app running even with no windows (standard behaviour)
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createMainWindow()
})
