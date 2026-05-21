'use strict'

const byId = (id) => document.getElementById(id)

const VIEWS = ['loading', 'login', 'validating', 'widget']
const view = Object.fromEntries(
  VIEWS.map((name) => [name, byId(`view-${name}`)])
)

const dom = {
  titlebar: byId('titlebar'),
  usagePanel: byId('usage-panel'),
  settingsPanel: byId('settings-panel'),
  detailsPanel: byId('details-panel'),
  chartBlock: byId('chart-block'),
  chartCanvas: byId('history-chart'),
  chartEmpty: byId('chart-empty'),
  chartSub: byId('chart-sub'),
  modelList: byId('model-list'),
  orgName: byId('org-name'),
  alltimeVal: byId('alltime-val'),
  alltimeMeta: byId('alltime-meta'),
  trackedSince: byId('tracked-since'),
  trackedMeta: byId('tracked-meta'),
  lastUpdated: byId('last-updated'),
  btnRefresh: byId('btn-refresh'),
  btnDetails: byId('btn-details'),
  btnCompact: byId('btn-compact'),
  btnSettings: byId('btn-settings'),
  btnMinimize: byId('btn-minimize'),
  btnClose: byId('btn-close'),
  btnAutoLogin: byId('btn-auto-login'),
  btnManualLogin: byId('btn-manual-login'),
  btnLogout: byId('btn-logout'),
  btnLogoutSettings: byId('btn-logout-settings'),
  btnSettingsBack: byId('btn-settings-back'),
  manualKey: byId('manual-key'),
  settingsTheme: byId('settings-theme'),
  settingsRefresh: byId('settings-refresh'),
  settingsWarn: byId('settings-warn'),
  settingsDanger: byId('settings-danger'),
  settingsAlwaysOnTop: byId('settings-always-on-top'),
  settingsNotifications: byId('settings-notifications'),
  settingsCompact: byId('settings-compact'),
  settingsShowGraph: byId('settings-show-graph'),
  settingsLaunch: byId('settings-launch')
}

const metricDom = {
  session: {
    row: byId('row-session'),
    pct: byId('session-pct'),
    reset: byId('session-reset'),
    bar: byId('session-bar')
  },
  weekly: {
    row: byId('row-weekly'),
    pct: byId('weekly-pct'),
    reset: byId('weekly-reset'),
    bar: byId('weekly-bar')
  },
  monthly: {
    row: byId('row-monthly'),
    pct: byId('monthly-val'),
    reset: byId('monthly-sub'),
    bar: byId('monthly-bar')
  }
}

const state = {
  currentView: 'loading',
  authenticated: false,
  settingsOpen: false,
  usage: null,
  chart: null,
  monthlyBaseline: 0,
  orgName: '',
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
  document.body.dataset.view = name
  VIEWS.forEach((key) => view[key]?.classList.add('hidden'))
  view[name]?.classList.remove('hidden')
  syncActionButtons()
  scheduleHeightSync()
}

function setOrgName(name) {
  state.orgName = name || ''
  dom.orgName.textContent = state.orgName
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

  dom.btnDetails.classList.toggle('is-active', effectiveDetailsOpen() && !state.settingsOpen)
  dom.btnCompact.classList.toggle('is-active', !!state.settings.compactMode)
  dom.btnSettings.classList.toggle('is-active', !!state.settingsOpen)
  dom.btnDetails.innerHTML = effectiveDetailsOpen() ? '&#9651;' : '&#9661;'
  dom.btnCompact.innerHTML = state.settings.compactMode ? '&#9645;' : '&#9633;'
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
  const numeric = Number(value)
  const abs = Math.abs(numeric)

  if (abs >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(numeric / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(numeric / 1_000).toFixed(1)}k`
  return String(Math.round(numeric))
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

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function startCountdowns(sessionResetsAt, weeklyResetsAt) {
  stopCountdowns()

  const tick = () => {
    metricDom.session.reset.textContent = formatReset(sessionResetsAt) || 'waiting for sync'
    metricDom.weekly.reset.textContent = formatReset(weeklyResetsAt) || 'waiting for sync'
  }

  tick()
  countdownHandle = setInterval(tick, 30_000)
}

function stopCountdowns() {
  if (!countdownHandle) return
  clearInterval(countdownHandle)
  countdownHandle = null
}

function getSeverity(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return 'pending'
  const value = Number(pct)
  if (value >= state.settings.dangerThreshold) return 'danger'
  if (value >= state.settings.warnThreshold) return 'warn'
  return 'healthy'
}

function setRowState(row, severity) {
  if (!row) return
  row.classList.remove('state-warn', 'state-danger')
  if (severity === 'warn') row.classList.add('state-warn')
  if (severity === 'danger') row.classList.add('state-danger')
}

function renderApiMetric(key, pct, resetsAt) {
  const metric = metricDom[key]
  if (!metric) return

  const severity = getSeverity(pct)
  setRowState(metric.row, severity)

  if (pct == null || Number.isNaN(Number(pct))) {
    metric.pct.textContent = '-'
    metric.bar.style.width = '0%'
    metric.reset.textContent = resetsAt ? formatReset(resetsAt) : 'waiting for sync'
    return
  }

  const clamped = Math.max(0, Math.min(100, Number(pct)))
  metric.pct.textContent = `${clamped.toFixed(1)}%`
  metric.bar.style.width = `${clamped}%`
  metric.reset.textContent = formatReset(resetsAt) || 'waiting for sync'
}

function renderMonthly(local) {
  const metric = metricDom.monthly
  const monthly = local?.monthlyTokens ?? null
  const today = local?.todayTokens ?? null
  const weekly = local?.weeklyTokens ?? null

  setRowState(metric.row, 'healthy')

  if (monthly == null) {
    metric.pct.textContent = '-'
    metric.bar.style.width = '0%'
    metric.reset.textContent = 'local stats not found'
    return
  }

  const baseline = Math.max(
    monthly,
    (weekly || 0) * 4.2,
    (today || 0) * 30,
    state.monthlyBaseline,
    1
  )

  state.monthlyBaseline = baseline

  const relativePct = Math.min(100, (monthly / baseline) * 100)
  const parts = []

  if (today != null) parts.push(`today ${formatTokens(today)}`)
  if (weekly != null) parts.push(`7d ${formatTokens(weekly)}`)

  metric.pct.textContent = formatTokens(monthly)
  metric.bar.style.width = `${relativePct}%`
  metric.reset.textContent = parts.join(' · ') || 'local 30-day total'
}

function renderSummary(local) {
  dom.alltimeVal.textContent = formatTokens(local?.allTimeTokens)

  if (local?.modelBreakdown?.length) {
    const count = local.modelBreakdown.length
    dom.alltimeMeta.textContent = `${count} model${count === 1 ? '' : 's'} tracked`
  } else {
    dom.alltimeMeta.textContent = 'No local model totals yet'
  }

  if (local?.firstSessionDate) {
    const first = new Date(local.firstSessionDate)
    const totalDays = Math.max(1, Math.ceil((Date.now() - first.getTime()) / 86_400_000))

    dom.trackedSince.textContent = Number.isNaN(first.getTime())
      ? '-'
      : formatShortDate(local.firstSessionDate)
    dom.trackedMeta.textContent = `${totalDays} day${totalDays === 1 ? '' : 's'} tracked`
  } else {
    dom.trackedSince.textContent = '-'
    dom.trackedMeta.textContent = 'Waiting for local history'
  }
}

function renderModelList(local) {
  const items = local?.modelBreakdown || []

  if (!items.length) {
    dom.modelList.innerHTML = '<p class="empty-state">No model totals in local stats.</p>'
    return
  }

  const maxTotal = Math.max(...items.map((item) => item.totalTokens || 0), 1)

  dom.modelList.innerHTML = items.map((item) => {
    const cacheTotal = (item.cacheReadInputTokens || 0) + (item.cacheCreationInputTokens || 0)
    const width = Math.max(6, Math.min(100, ((item.totalTokens || 0) / maxTotal) * 100))

    return `
      <article class="model-row">
        <div class="model-top">
          <span class="model-name">${escapeHtml(item.label || item.key || 'Unknown')}</span>
          <span class="model-total">${escapeHtml(formatTokens(item.totalTokens || 0))}</span>
        </div>
        <div class="bar-track"><div class="bar-fill local" style="width:${width}%"></div></div>
        <div class="model-meta">
          in ${escapeHtml(formatTokens(item.inputTokens || 0))} · out ${escapeHtml(formatTokens(item.outputTokens || 0))} · cache ${escapeHtml(formatTokens(cacheTotal))}
        </div>
      </article>
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

function withAlpha(color, alpha) {
  const value = String(color || '').trim()

  if (/^#([0-9a-f]{3})$/i.test(value)) {
    const hex = value.slice(1).split('').map((char) => char + char).join('')
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  if (/^#([0-9a-f]{6})$/i.test(value)) {
    const hex = value.slice(1)
    const r = Number.parseInt(hex.slice(0, 2), 16)
    const g = Number.parseInt(hex.slice(2, 4), 16)
    const b = Number.parseInt(hex.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i)
  if (rgbMatch) {
    const [r, g, b] = rgbMatch[1].split(',').map((part) => part.trim())
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }

  return `rgba(126, 167, 199, ${alpha})`
}

function renderHistoryChart(history) {
  const shouldShow = effectiveDetailsOpen() && !!state.settings.showGraph && !state.settingsOpen
  dom.chartBlock.classList.toggle('hidden', !shouldShow)

  if (!shouldShow) return

  const points = buildHistoryPoints(history, 7)
  const hasData = points.some((point) => point.tokens > 0)

  dom.chartSub.textContent = 'local tokens'
  dom.chartEmpty.classList.toggle('hidden', hasData)
  dom.chartCanvas.classList.toggle('hidden', !hasData)

  if (!hasData || typeof window.Chart !== 'function') {
    if (state.chart) {
      state.chart.destroy()
      state.chart = null
    }
    return
  }

  const styles = getComputedStyle(document.documentElement)
  const localColor = styles.getPropertyValue('--local').trim() || '#7EA7C7'
  const mutedColor = styles.getPropertyValue('--muted').trim() || '#8A8A93'
  const borderColor = styles.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.08)'
  const tooltipBg = styles.getPropertyValue('--bg-card').trim() || '#1C1C21'
  const textColor = styles.getPropertyValue('--text').trim() || '#ECECEC'

  const ctx = dom.chartCanvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 0, dom.chartCanvas.height || 160)
  gradient.addColorStop(0, withAlpha(localColor, 0.35))
  gradient.addColorStop(1, withAlpha(localColor, 0.04))

  const config = {
    type: 'line',
    data: {
      labels: points.map((point) => point.label),
      datasets: [{
        data: points.map((point) => point.tokens),
        borderColor: localColor,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: localColor,
        pointBorderWidth: 0
      }]
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: tooltipBg,
          titleColor: textColor,
          bodyColor: textColor,
          borderColor,
          borderWidth: 1,
          displayColors: false,
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

  if (!state.chart) {
    state.chart = new window.Chart(ctx, config)
  } else {
    state.chart.data = config.data
    state.chart.options = config.options
    state.chart.update()
  }
}

function renderUsageData(payload) {
  state.usage = payload

  renderApiMetric('session', payload?.api?.sessionPct ?? null, payload?.api?.sessionResetsAt ?? null)
  renderApiMetric('weekly', payload?.api?.weeklyPct ?? null, payload?.api?.weeklyResetsAt ?? null)
  renderMonthly(payload?.local || null)
  renderSummary(payload?.local || null)
  renderModelList(payload?.local || null)
  renderHistoryChart(payload?.local?.history || [])

  startCountdowns(payload?.api?.sessionResetsAt ?? null, payload?.api?.weeklyResetsAt ?? null)

  dom.lastUpdated.textContent = payload?.lastUpdated
    ? `updated ${formatClock(payload.lastUpdated)}`
    : 'waiting for first sync'

  scheduleHeightSync()
}

function resetUsageUi() {
  state.usage = null
  renderApiMetric('session', null, null)
  renderApiMetric('weekly', null, null)
  renderMonthly(null)
  renderSummary(null)
  renderModelList(null)
  renderHistoryChart([])
  dom.lastUpdated.textContent = 'waiting for first sync'
}

function applyTheme() {
  const preferred = state.settings.theme === 'system'
    ? (systemThemeQuery?.matches ? 'dark' : 'light')
    : state.settings.theme

  document.documentElement.dataset.theme = preferred

  if (state.usage?.local) {
    renderHistoryChart(state.usage.local.history || [])
  }
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

function syncUiFromSettings() {
  syncSettingsForm()
  applyTheme()

  document.body.classList.toggle('compact-mode', !!state.settings.compactMode)
  document.body.classList.toggle('settings-open', !!state.settingsOpen)
  document.body.classList.toggle('details-open', effectiveDetailsOpen() && !state.settingsOpen)

  dom.usagePanel.classList.toggle('hidden', !!state.settingsOpen)
  dom.settingsPanel.classList.toggle('hidden', !state.settingsOpen)
  dom.detailsPanel.classList.toggle('hidden', !effectiveDetailsOpen() || !!state.settingsOpen)
  dom.chartBlock.classList.toggle('hidden', !effectiveDetailsOpen() || !state.settings.showGraph || !!state.settingsOpen)

  syncActionButtons()

  if (state.usage) renderUsageData(state.usage)
  else resetUsageUi()

  scheduleHeightSync()
}

function scheduleHeightSync() {
  if (heightFrame) cancelAnimationFrame(heightFrame)

  heightFrame = requestAnimationFrame(() => {
    if (state.currentView !== 'widget') return

    const target = state.settingsOpen ? dom.settingsPanel : dom.usagePanel
    if (!target || target.classList.contains('hidden')) return

    const desired = dom.titlebar.offsetHeight + target.scrollHeight + 34
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
  syncUiFromSettings()
  window.api.getSettings()

  if (!fromMain) window.api.openSettings()
}

function closeSettingsPanel({ skipIpc = false } = {}) {
  state.settingsOpen = false
  syncUiFromSettings()

  if (!skipIpc) window.api.closeSettings()
}

function resetWidgetPanels() {
  state.settingsOpen = false
  syncUiFromSettings()
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
    if (!key) {
      dom.manualKey.focus()
      return
    }

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

  window.addEventListener('resize', scheduleHeightSync)
}

function bindIpc() {
  window.api.onAuthNeeded(() => {
    setOrgName('')
    setAuthenticated(false)
    resetWidgetPanels()
    resetUsageUi()
    showView('login')
  })

  window.api.onAuthValidating(() => {
    setAuthenticated(false)
    showView('validating')
  })

  window.api.onAuthSuccess((data) => {
    setOrgName(data.orgName || data.orgId || '')
    setAuthenticated(true)
    resetWidgetPanels()
    resetUsageUi()
    showView('widget')
    syncUiFromSettings()
  })

  window.api.onAuthExpired(() => {
    dom.manualKey.value = ''
    setOrgName('')
    setAuthenticated(false)
    stopCountdowns()
    resetWidgetPanels()
    resetUsageUi()
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
resetUsageUi()
syncActionButtons()
