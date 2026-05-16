'use strict'

const VIEWS = ['loading', 'login', 'validating', 'widget']
const view = Object.fromEntries(
  VIEWS.map((name) => [name, document.getElementById(`view-${name}`)])
)

const dom = {
  titlebar: document.getElementById('titlebar'),
  viewWidget: document.getElementById('view-widget'),
  usagePanel: document.getElementById('usage-panel'),
  settingsPanel: document.getElementById('settings-panel'),
  detailsPanel: document.getElementById('details-panel'),
  chartBlock: document.getElementById('chart-block'),
  chartCanvas: document.getElementById('history-chart'),
  chartEmpty: document.getElementById('chart-empty'),
  modelList: document.getElementById('model-list'),
  orgName: document.getElementById('org-name'),
  lastUpdated: document.getElementById('last-updated'),
  trackedSince: document.getElementById('tracked-since'),
  trackedMeta: document.getElementById('tracked-meta'),
  alltimeVal: document.getElementById('alltime-val'),
  alltimeMeta: document.getElementById('alltime-meta'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnDetails: document.getElementById('btn-details'),
  btnCompact: document.getElementById('btn-compact'),
  btnSettings: document.getElementById('btn-settings'),
  btnMinimize: document.getElementById('btn-minimize'),
  btnClose: document.getElementById('btn-close'),
  btnAutoLogin: document.getElementById('btn-auto-login'),
  btnManualLogin: document.getElementById('btn-manual-login'),
  btnLogout: document.getElementById('btn-logout'),
  btnLogoutSettings: document.getElementById('btn-logout-settings'),
  btnSettingsBack: document.getElementById('btn-settings-back'),
  manualKey: document.getElementById('manual-key'),
  settingsTheme: document.getElementById('settings-theme'),
  settingsRefresh: document.getElementById('settings-refresh'),
  settingsWarn: document.getElementById('settings-warn'),
  settingsDanger: document.getElementById('settings-danger'),
  settingsAlwaysOnTop: document.getElementById('settings-always-on-top'),
  settingsNotifications: document.getElementById('settings-notifications'),
  settingsCompact: document.getElementById('settings-compact'),
  settingsShowGraph: document.getElementById('settings-show-graph'),
  settingsLaunch: document.getElementById('settings-launch')
}

const state = {
  currentView: 'loading',
  authenticated: false,
  settingsOpen: false,
  usage: null,
  chart: null,
  monthlyBaseline: 0,
  settings: {
    refreshInterval: 5,
    alwaysOnTop: true,
    theme: 'system',
    compactMode: false,
    warnThreshold: 70,
    dangerThreshold: 90,
    notifications: true,
    launchAtStartup: false,
    showGraph: false,
    isExpanded: false,
    timeFormat: '12h',
    dateFormat: 'short'
  }
}

const systemThemeQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

let countdownHandle = null
let heightFrame = null

function showView(name) {
  state.currentView = name
  VIEWS.forEach((key) => view[key].classList.add('hidden'))
  view[name]?.classList.remove('hidden')
}

function setAuthenticated(flag) {
  state.authenticated = Boolean(flag)
  syncActionButtons()
}

function effectiveDetailsOpen() {
  return state.authenticated && !state.settings.compactMode && Boolean(state.settings.isExpanded)
}

function syncActionButtons() {
  const canUseWidgetActions = state.authenticated && state.currentView === 'widget'
  dom.btnRefresh.disabled = !canUseWidgetActions
  dom.btnDetails.disabled = !canUseWidgetActions || state.settingsOpen || state.settings.compactMode
  dom.btnCompact.disabled = !canUseWidgetActions || state.settingsOpen
  dom.btnSettings.disabled = !canUseWidgetActions

  dom.btnDetails.classList.toggle('is-active', effectiveDetailsOpen())
  dom.btnCompact.classList.toggle('is-active', !!state.settings.compactMode)
  dom.btnSettings.classList.toggle('is-active', !!state.settingsOpen)
  dom.btnDetails.innerHTML = effectiveDetailsOpen() ? '&#9651;' : '&#9661;'
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function toLocalIsoDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTokens(value) {
  if (value == null || Number.isNaN(Number(value))) return '-'
  const abs = Math.abs(Number(value))
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}

function formatShortDate(isoDate) {
  if (!isoDate) return '-'
  const date = new Date(isoDate)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatClock(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: state.settings.timeFormat !== '24h'
  })
}

function formatReset(isoDate) {
  if (!isoDate) return ''

  const diff = new Date(isoDate).getTime() - Date.now()
  if (!Number.isFinite(diff)) return ''
  if (diff <= 0) return 'resetting...'

  const totalMinutes = Math.floor(diff / 60_000)
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `resets in ${days}d ${hours}h`
  if (hours > 0) return `resets in ${hours}h ${minutes}m`
  return `resets in ${minutes}m`
}

function startCountdowns(sessionResetsAt, weeklyResetsAt) {
  if (countdownHandle) clearInterval(countdownHandle)

  const tick = () => {
    const sessionReset = document.getElementById('session-reset')
    const weeklyReset = document.getElementById('weekly-reset')
    if (sessionReset) sessionReset.textContent = formatReset(sessionResetsAt)
    if (weeklyReset) weeklyReset.textContent = formatReset(weeklyResetsAt)
  }

  tick()
  countdownHandle = setInterval(tick, 30_000)
}

function stopCountdowns() {
  if (countdownHandle) {
    clearInterval(countdownHandle)
    countdownHandle = null
  }
}

function renderBar(barId, pctId, rowId, pct) {
  const bar = document.getElementById(barId)
  const label = document.getElementById(pctId)
  const row = document.getElementById(rowId)
  if (!bar || !label || !row) return

  if (pct == null || Number.isNaN(Number(pct))) {
    label.textContent = '-'
    bar.style.width = '0%'
    row.classList.remove('state-warn', 'state-danger')
    return
  }

  const clamped = Math.max(0, Math.min(100, Number(pct)))
  label.textContent = `${clamped.toFixed(1)}%`
  bar.style.width = `${clamped}%`

  row.classList.remove('state-warn', 'state-danger')
  if (clamped >= state.settings.dangerThreshold) row.classList.add('state-danger')
  else if (clamped >= state.settings.warnThreshold) row.classList.add('state-warn')
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function applyTheme() {
  const preferred = state.settings.theme === 'system'
    ? (systemThemeQuery?.matches ? 'dark' : 'light')
    : state.settings.theme

  document.documentElement.dataset.theme = preferred

  if (state.usage?.local) renderHistoryChart(state.usage.local.history || [])
}

function syncSettingsForm() {
  dom.settingsTheme.value = state.settings.theme || 'system'
  dom.settingsRefresh.value = state.settings.refreshInterval ?? 5
  dom.settingsWarn.value = state.settings.warnThreshold ?? 70
  dom.settingsDanger.value = state.settings.dangerThreshold ?? 90
  dom.settingsAlwaysOnTop.checked = !!state.settings.alwaysOnTop
  dom.settingsNotifications.checked = !!state.settings.notifications
  dom.settingsCompact.checked = !!state.settings.compactMode
  dom.settingsShowGraph.checked = !!state.settings.showGraph
  dom.settingsLaunch.checked = !!state.settings.launchAtStartup
}

function renderModelList(local) {
  const items = local?.modelBreakdown || []
  if (!items.length) {
    dom.modelList.innerHTML = '<p class="empty-state">No model totals in local stats.</p>'
    return
  }

  dom.modelList.innerHTML = items.map((item) => {
    const cacheTotal = (item.cacheReadInputTokens || 0) + (item.cacheCreationInputTokens || 0)
    return `
      <div class="model-row">
        <div class="model-top">
          <span class="model-name">${escapeHtml(item.label || item.key || 'Unknown')}</span>
          <span class="model-total">${escapeHtml(formatTokens(item.totalTokens))}</span>
        </div>
        <div class="model-meta">
          input ${escapeHtml(formatTokens(item.inputTokens || 0))} | output ${escapeHtml(formatTokens(item.outputTokens || 0))} | cache ${escapeHtml(formatTokens(cacheTotal))}
        </div>
      </div>
    `
  }).join('')
}

function buildHistoryPoints(history, days) {
  const source = Array.isArray(history) ? history : []
  const byDate = new Map(source.map((entry) => [entry.date, entry.tokens || 0]))
  const formatter = new Intl.DateTimeFormat([], { weekday: 'short' })
  const points = []

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - offset)
    const iso = toLocalIsoDate(date)
    points.push({
      date: iso,
      label: formatter.format(date),
      tokens: byDate.get(iso) || 0
    })
  }

  return points
}

function renderHistoryChart(history) {
  const shouldShow = effectiveDetailsOpen() && !!state.settings.showGraph
  dom.chartBlock.classList.toggle('hidden', !shouldShow)

  if (!shouldShow) {
    dom.chartEmpty.classList.add('hidden')
    return
  }

  const points = buildHistoryPoints(history, 7)
  const hasData = points.some((point) => point.tokens > 0)
  dom.chartEmpty.classList.toggle('hidden', hasData)
  dom.chartCanvas.classList.toggle('hidden', !hasData)

  if (!hasData) {
    return
  }

  const styles = getComputedStyle(document.documentElement)
  const textColor = styles.getPropertyValue('--text').trim()
  const mutedColor = styles.getPropertyValue('--muted').trim()
  const borderColor = styles.getPropertyValue('--border').trim()
  const accentColor = styles.getPropertyValue('--local').trim()

  const config = {
    type: 'bar',
    data: {
      labels: points.map((point) => point.label),
      datasets: [{
        data: points.map((point) => point.tokens),
        backgroundColor: accentColor,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 28
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => points[items[0].dataIndex]?.date || '',
            label: (item) => `${formatTokens(item.parsed.y)} tokens`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: mutedColor }
        },
        y: {
          beginAtZero: true,
          grid: { color: borderColor },
          ticks: {
            color: mutedColor,
            callback: (value) => formatTokens(value)
          }
        }
      }
    }
  }

  if (!state.chart && typeof window.Chart === 'function') {
    state.chart = new window.Chart(dom.chartCanvas, config)
  } else if (state.chart) {
    state.chart.data = config.data
    state.chart.options = config.options
    state.chart.update()
  }

  dom.chartCanvas.style.color = textColor
}

function renderSummary(local) {
  dom.alltimeVal.textContent = formatTokens(local?.allTimeTokens)
  dom.alltimeMeta.textContent = local?.modelBreakdown?.length
    ? `${local.modelBreakdown.length} model${local.modelBreakdown.length === 1 ? '' : 's'}`
    : ''

  if (local?.firstSessionDate) {
    const first = new Date(local.firstSessionDate)
    dom.trackedSince.textContent = Number.isNaN(first.getTime())
      ? '-'
      : first.toLocaleDateString([], { month: 'short', day: 'numeric' })

    const totalDays = Math.max(1, Math.ceil((Date.now() - first.getTime()) / 86_400_000))
    dom.trackedMeta.textContent = `${totalDays} days tracked`
  } else {
    dom.trackedSince.textContent = '-'
    dom.trackedMeta.textContent = ''
  }
}

function renderMonthly(local) {
  const monthly = local?.monthlyTokens ?? null
  document.getElementById('monthly-val').textContent = formatTokens(monthly)

  const monthlyBar = document.getElementById('monthly-bar')
  if (!monthlyBar) return

  if (monthly == null) {
    monthlyBar.style.width = '0%'
    document.getElementById('monthly-sub').textContent = ''
    return
  }

  state.monthlyBaseline = Math.max(state.monthlyBaseline, monthly)
  const relativePct = state.monthlyBaseline > 0 ? (monthly / state.monthlyBaseline) * 100 : 0
  monthlyBar.style.width = `${Math.min(100, relativePct)}%`

  const parts = []
  if (local?.todayTokens != null) parts.push(`today ${formatTokens(local.todayTokens)}`)
  if (local?.weeklyTokens != null) parts.push(`week ${formatTokens(local.weeklyTokens)}`)
  document.getElementById('monthly-sub').textContent = parts.join(' | ')
}

function renderUsageData(payload) {
  state.usage = payload

  renderBar('session-bar', 'session-pct', 'row-session', payload?.api?.sessionPct ?? null)
  renderBar('weekly-bar', 'weekly-pct', 'row-weekly', payload?.api?.weeklyPct ?? null)
  renderMonthly(payload?.local || null)
  renderSummary(payload?.local || null)
  renderModelList(payload?.local || null)
  renderHistoryChart(payload?.local?.history || [])

  startCountdowns(payload?.api?.sessionResetsAt ?? null, payload?.api?.weeklyResetsAt ?? null)

  if (payload?.lastUpdated) {
    dom.lastUpdated.textContent = `updated ${formatClock(payload.lastUpdated)}`
  } else {
    dom.lastUpdated.textContent = ''
  }

  scheduleHeightSync()
}

function syncUiFromSettings() {
  syncSettingsForm()
  applyTheme()

  document.body.classList.toggle('compact-mode', !!state.settings.compactMode)
  document.body.classList.toggle('settings-open', !!state.settingsOpen)
  dom.detailsPanel.classList.toggle('hidden', !effectiveDetailsOpen())
  dom.chartBlock.classList.toggle('hidden', !effectiveDetailsOpen() || !state.settings.showGraph)

  syncActionButtons()

  if (state.usage) {
    renderBar('session-bar', 'session-pct', 'row-session', state.usage?.api?.sessionPct ?? null)
    renderBar('weekly-bar', 'weekly-pct', 'row-weekly', state.usage?.api?.weeklyPct ?? null)
    renderMonthly(state.usage?.local || null)
    renderSummary(state.usage?.local || null)
    renderModelList(state.usage?.local || null)
    renderHistoryChart(state.usage?.local?.history || [])
  }

  scheduleHeightSync()
}

function scheduleHeightSync() {
  if (heightFrame) cancelAnimationFrame(heightFrame)

  heightFrame = requestAnimationFrame(() => {
    if (state.currentView !== 'widget') return

    const target = state.settingsOpen ? dom.settingsPanel : dom.usagePanel
    if (!target || target.classList.contains('hidden')) return

    const desired = dom.titlebar.offsetHeight + target.scrollHeight + 28
    window.api.setWindowHeight(desired)
  })
}

function saveSettingsPatch(patch, { optimistic = true } = {}) {
  if (optimistic) {
    state.settings = { ...state.settings, ...patch }
    syncUiFromSettings()
  }

  window.api.saveSettings(patch)
}

function openSettingsPanel({ fromMain = false } = {}) {
  if (state.currentView !== 'widget' || !state.authenticated) return

  state.settingsOpen = true
  dom.usagePanel.classList.add('hidden')
  dom.settingsPanel.classList.remove('hidden')
  syncUiFromSettings()
  window.api.getSettings()

  if (!fromMain) window.api.openSettings()
}

function closeSettingsPanel({ skipIpc = false } = {}) {
  state.settingsOpen = false
  dom.settingsPanel.classList.add('hidden')
  dom.usagePanel.classList.remove('hidden')
  syncUiFromSettings()

  if (!skipIpc) window.api.closeSettings()
}

function resetWidgetPanels() {
  state.settingsOpen = false
  dom.settingsPanel.classList.add('hidden')
  dom.usagePanel.classList.remove('hidden')
  document.body.classList.remove('settings-open')
}

function persistThresholds(changed) {
  let warn = clampInt(dom.settingsWarn.value, 1, 99, state.settings.warnThreshold || 70)
  let danger = clampInt(dom.settingsDanger.value, 2, 100, state.settings.dangerThreshold || 90)

  if (warn >= danger) {
    if (changed === 'warn') warn = Math.max(1, danger - 1)
    else danger = Math.min(100, warn + 1)
  }

  dom.settingsWarn.value = warn
  dom.settingsDanger.value = danger
  saveSettingsPatch({ warnThreshold: warn, dangerThreshold: danger })
}

function bindEvents() {
  dom.btnMinimize.addEventListener('click', () => window.api.minimize())
  dom.btnClose.addEventListener('click', () => window.api.close())
  dom.btnRefresh.addEventListener('click', () => window.api.requestUsage())

  dom.btnDetails.addEventListener('click', () => {
    if (dom.btnDetails.disabled) return
    saveSettingsPatch({ isExpanded: !state.settings.isExpanded })
  })

  dom.btnCompact.addEventListener('click', () => {
    if (dom.btnCompact.disabled) return
    saveSettingsPatch({ compactMode: !state.settings.compactMode })
  })

  dom.btnSettings.addEventListener('click', () => {
    if (dom.btnSettings.disabled) return
    if (state.settingsOpen) closeSettingsPanel()
    else openSettingsPanel()
  })

  dom.btnSettingsBack.addEventListener('click', () => closeSettingsPanel())

  dom.btnAutoLogin.addEventListener('click', () => {
    window.api.startLogin()
    showView('loading')
  })

  dom.btnManualLogin.addEventListener('click', () => {
    const key = dom.manualKey.value.trim()
    if (!key) return
    window.api.manualLogin(key)
    showView('validating')
  })

  dom.manualKey.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') dom.btnManualLogin.click()
  })

  const logout = () => {
    stopCountdowns()
    window.api.logout()
  }

  dom.btnLogout.addEventListener('click', logout)
  dom.btnLogoutSettings.addEventListener('click', logout)

  dom.settingsTheme.addEventListener('change', () => {
    saveSettingsPatch({ theme: dom.settingsTheme.value })
  })

  const saveRefreshInterval = () => {
    const refreshInterval = clampInt(dom.settingsRefresh.value, 1, 60, state.settings.refreshInterval || 5)
    dom.settingsRefresh.value = refreshInterval
    saveSettingsPatch({ refreshInterval })
  }

  dom.settingsRefresh.addEventListener('change', saveRefreshInterval)
  dom.settingsRefresh.addEventListener('blur', saveRefreshInterval)

  dom.settingsWarn.addEventListener('change', () => persistThresholds('warn'))
  dom.settingsWarn.addEventListener('blur', () => persistThresholds('warn'))
  dom.settingsDanger.addEventListener('change', () => persistThresholds('danger'))
  dom.settingsDanger.addEventListener('blur', () => persistThresholds('danger'))

  dom.settingsAlwaysOnTop.addEventListener('change', () => {
    saveSettingsPatch({ alwaysOnTop: dom.settingsAlwaysOnTop.checked })
  })

  dom.settingsNotifications.addEventListener('change', () => {
    saveSettingsPatch({ notifications: dom.settingsNotifications.checked })
  })

  dom.settingsCompact.addEventListener('change', () => {
    saveSettingsPatch({ compactMode: dom.settingsCompact.checked })
  })

  dom.settingsShowGraph.addEventListener('change', () => {
    saveSettingsPatch({ showGraph: dom.settingsShowGraph.checked })
  })

  dom.settingsLaunch.addEventListener('change', () => {
    saveSettingsPatch({ launchAtStartup: dom.settingsLaunch.checked })
  })
}

function bindIpc() {
  window.api.onAuthNeeded(() => {
    setAuthenticated(false)
    resetWidgetPanels()
    showView('login')
  })

  window.api.onAuthValidating(() => {
    setAuthenticated(false)
    showView('validating')
  })

  window.api.onAuthSuccess((data) => {
    dom.orgName.textContent = data.orgName || data.orgId || ''
    setAuthenticated(true)
    resetWidgetPanels()
    showView('widget')
    syncUiFromSettings()
  })

  window.api.onAuthExpired(() => {
    dom.manualKey.value = ''
    dom.orgName.textContent = ''
    setAuthenticated(false)
    stopCountdowns()
    resetWidgetPanels()
    showView('login')
  })

  window.api.onUsage((data) => {
    renderUsageData(data)
  })

  window.api.onSettings((settings) => {
    state.settings = { ...state.settings, ...settings }
    syncUiFromSettings()
  })

  window.api.onSettingsShow(() => {
    openSettingsPanel({ fromMain: true })
  })

  window.api.onCompactChange((value) => {
    state.settings = { ...state.settings, compactMode: Boolean(value) }
    syncUiFromSettings()
  })
}

if (systemThemeQuery) {
  const handler = () => {
    if (state.settings.theme === 'system') applyTheme()
  }

  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', handler)
  } else if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(handler)
  }
}

bindEvents()
bindIpc()
window.api.getSettings()
showView('loading')
syncActionButtons()
