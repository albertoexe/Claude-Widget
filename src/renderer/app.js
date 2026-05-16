'use strict'

/**
 * app.js — renderer process
 *
 * M1 scope: login UI only (auto-detect + manual key).
 * Communicates with main via window.api (contextBridge in preload.js).
 */

// ── View management ───────────────────────────────────────────────────────────

const VIEWS = ['loading', 'login', 'validating', 'widget']

const view = Object.fromEntries(
  VIEWS.map(name => [name, document.getElementById(`view-${name}`)])
)

function showView (name) {
  VIEWS.forEach(v => view[v].classList.add('hidden'))
  if (view[name]) view[name].classList.remove('hidden')
  else console.warn('[app] Unknown view:', name)
}

// ── Window controls ───────────────────────────────────────────────────────────

document.getElementById('btn-minimize').addEventListener('click', () =>
  window.api.minimize()
)
document.getElementById('btn-close').addEventListener('click', () =>
  window.api.close()
)

// ── Login — auto-detect ───────────────────────────────────────────────────────

document.getElementById('btn-auto-login').addEventListener('click', () => {
  window.api.startLogin()
  showView('loading')
})

// ── Login — manual key ────────────────────────────────────────────────────────

document.getElementById('btn-manual-login').addEventListener('click', () => {
  const key = document.getElementById('manual-key').value.trim()
  if (!key) return
  window.api.manualLogin(key)
  showView('validating')
})

// Allow Enter key to submit manual key
document.getElementById('manual-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-manual-login').click()
})

// ── Logout ────────────────────────────────────────────────────────────────────

document.getElementById('btn-logout').addEventListener('click', () => {
  window.api.logout()
})

// ── IPC event listeners (main → renderer) ─────────────────────────────────────

window.api.onAuthNeeded(() => {
  showView('login')
})

window.api.onAuthValidating(() => {
  showView('validating')
})

window.api.onAuthSuccess((data) => {
  const orgEl = document.getElementById('org-name')
  orgEl.textContent = data.orgName || data.orgId || ''
  showView('widget')
})

window.api.onAuthExpired(() => {
  // Clear any stale manual-key input
  document.getElementById('manual-key').value = ''
  showView('login')
})

// ── Boot ──────────────────────────────────────────────────────────────────────

// Start in loading state; main.js sends auth:needed or auth:success after ~600ms
showView('loading')
