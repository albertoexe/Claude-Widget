'use strict'

/**
 * app.js — renderer process
 *
 * M2 additions: receive usage:push, render 3 data rows
 * (session %, weekly %, monthly tokens), reset countdowns.
 */

// ── View management ───────────────────────────────────────────────────────────

const VIEWS = ['loading', 'login', 'validating', 'widget']
const view  = Object.fromEntries(
  VIEWS.map(n => [n, document.getElementById(`view-${n}`)])
)

function showView (name) {
  VIEWS.forEach(v => view[v].classList.add('hidden'))
  view[name]?.classList.remove('hidden')
}

// ── Cached settings (from main) ───────────────────────────────────────────────

let settings = { warnThreshold: 70, dangerThreshold: 90 }
window.api.getSettings()
window.api.onSettings(s => { settings = { ...settings, ...s } })

// ── Countdown timer ───────────────────────────────────────────────────────────

let countdownHandle = null

function startCountdowns (sessionResetsAt, weeklyResetsAt) {
  if (countdownHandle) clearInterval(countdownHandle)

  function tick () {
    renderReset('session-reset', sessionResetsAt)
    renderReset('weekly-reset',  weeklyResetsAt)
  }
  tick()
  countdownHandle = setInterval(tick, 60_000)   // update every minute
}

function renderReset (elId, isoDate) {
  const el = document.getElementById(elId)
  if (!el) return
  if (!isoDate) { el.textContent = ''; return }

  const diff = new Date(isoDate) - Date.now()
  if (diff <= 0) { el.textContent = 'resetting…'; return }

  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)

  el.textContent = h > 0
    ? `resets in ${h}h ${m}m`
    : `resets in ${m}m`
}

// ── Progress bar rendering ────────────────────────────────────────────────────

/**
 * Paint one bar row.
 * @param {string} barId     - element id of the .bar-fill div
 * @param {string} pctId     - element id of the percentage label
 * @param {string} rowId     - element id of the .usage-row wrapper (for colour class)
 * @param {number|null} pct  - 0–100 (null → show dash)
 */
function renderBar (barId, pctId, rowId, pct) {
  const bar  = document.getElementById(barId)
  const label = document.getElementById(pctId)
  const row  = document.getElementById(rowId)
  if (!bar || !label || !row) return

  if (pct == null) {
    label.textContent = '—'
    bar.style.width   = '0%'
    row.className     = 'usage-row'
    return
  }

  const clamped = Math.min(100, Math.max(0, pct))
  bar.style.width   = `${clamped}%`
  label.textContent = `${clamped.toFixed(1)}%`

  // Colour state
  row.classList.remove('state-warn', 'state-danger')
  if (clamped >= settings.dangerThreshold) row.classList.add('state-danger')
  else if (clamped >= settings.warnThreshold)  row.classList.add('state-warn')
}

// ── Token formatter ───────────────────────────────────────────────────────────

function formatTokens (n) {
  if (n == null || isNaN(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── Usage data handler ────────────────────────────────────────────────────────

/** Last seen local stats — used to keep monthly bar proportional */
let lastMonthlyMax = 0

function onUsageData ({ api, local, lastUpdated }) {
  // Session bar
  renderBar('session-bar', 'session-pct', 'row-session', api?.sessionPct ?? null)

  // Weekly bar
  renderBar('weekly-bar', 'weekly-pct', 'row-weekly', api?.weeklyPct ?? null)

  // Monthly tokens (local stats-cache.json)
  const monthly = local?.monthlyTokens ?? null
  document.getElementById('monthly-val').textContent = formatTokens(monthly)

  if (monthly != null) {
    // Keep a running max so the bar stays proportional across refreshes
    if (monthly > lastMonthlyMax) lastMonthlyMax = monthly
    const relativePct = lastMonthlyMax > 0 ? (monthly / lastMonthlyMax) * 100 : 0
    const bar = document.getElementById('monthly-bar')
    if (bar) bar.style.width = `${Math.min(100, relativePct)}%`

    // Sub-label: today + weekly tokens
    const sub = document.getElementById('monthly-sub')
    if (sub) {
      const parts = []
      if (local.todayTokens != null)  parts.push(`today ${formatTokens(local.todayTokens)}`)
      if (local.weeklyTokens != null) parts.push(`week ${formatTokens(local.weeklyTokens)}`)
      sub.textContent = parts.join(' · ')
    }
  }

  // Start / refresh countdowns
  startCountdowns(api?.sessionResetsAt ?? null, api?.weeklyResetsAt ?? null)

  // Footer timestamp
  const el = document.getElementById('last-updated')
  if (el && lastUpdated) {
    const d = new Date(lastUpdated)
    el.textContent = `updated ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
}

// ── Window controls ───────────────────────────────────────────────────────────

document.getElementById('btn-minimize').addEventListener('click', () => window.api.minimize())
document.getElementById('btn-close').addEventListener('click',    () => window.api.close())
document.getElementById('btn-refresh').addEventListener('click',  () => window.api.requestUsage())

// ── Login ─────────────────────────────────────────────────────────────────────

document.getElementById('btn-auto-login').addEventListener('click', () => {
  window.api.startLogin()
  showView('loading')
})

document.getElementById('btn-manual-login').addEventListener('click', () => {
  const key = document.getElementById('manual-key').value.trim()
  if (!key) return
  window.api.manualLogin(key)
  showView('validating')
})

document.getElementById('manual-key').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-manual-login').click()
})

// ── Logout ────────────────────────────────────────────────────────────────────

document.getElementById('btn-logout').addEventListener('click', () => {
  if (countdownHandle) { clearInterval(countdownHandle); countdownHandle = null }
  window.api.logout()
})

// ── IPC listeners (main → renderer) ──────────────────────────────────────────

window.api.onAuthNeeded(() => {
  showView('login')
})

window.api.onAuthValidating(() => {
  showView('validating')
})

window.api.onAuthSuccess((data) => {
  const badge = document.getElementById('org-name')
  if (badge) badge.textContent = data.orgName || data.orgId || ''
  showView('widget')
})

window.api.onAuthExpired(() => {
  document.getElementById('manual-key').value = ''
  if (countdownHandle) { clearInterval(countdownHandle); countdownHandle = null }
  showView('login')
})

window.api.onUsage((data) => {
  onUsageData(data)
})

// ── Boot ──────────────────────────────────────────────────────────────────────

showView('loading')
