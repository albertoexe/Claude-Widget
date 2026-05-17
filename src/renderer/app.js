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
  heroOrg: document.getElementById('hero-org'),
  heroUpdated: document.getElementById('hero-updated'),
  mascotStatus: document.getElementById('mascot-status'),
  factToday: document.getElementById('fact-today'),
  factWeek: document.getElementById('fact-week'),
  factAlltime: document.getElementById('fact-alltime'),
  alltimeVal: document.getElementById('alltime-val'),
  alltimeMeta: document.getElementById('alltime-meta'),
  trackedSince: document.getElementById('tracked-since'),
  trackedMeta: document.getElementById('tracked-meta'),
  topModel: document.getElementById('top-model'),
  topModelMeta: document.getElementById('top-model-meta'),
  lastUpdated: document.getElementById('last-updated'),
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
  settingsLaunch: document.getElementById('settings-launch'),
  resizeGrip: document.getElementById('resize-grip')
}

const metricDom = {
  session: {
    row: document.getElementById('row-session'),
    status: document.getElementById('session-status'),
    pct: document.getElementById('session-pct'),
    reset: document.getElementById('session-reset'),
    bar: document.getElementById('session-bar'),
    ring: document.getElementById('session-ring'),
    ringLabel: document.getElementById('session-ring-label')
  },
  weekly: {
    row: document.getElementById('row-weekly'),
    status: document.getElementById('weekly-status'),
    pct: document.getElementById('weekly-pct'),
    reset: document.getElementById('weekly-reset'),
    bar: document.getElementById('weekly-bar'),
    ring: document.getElementById('weekly-ring'),
    ringLabel: document.getElementById('weekly-ring-label')
  },
  monthly: {
    row: document.getElementById('row-monthly'),
    status: document.getElementById('monthly-status'),
    pct: document.getElementById('monthly-val'),
    reset: document.getElementById('monthly-sub'),
    bar: document.getElementById('monthly-bar'),
    ring: document.getElementById('monthly-ring'),
    ringLabel: document.getElementById('monthly-ring-label')
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
let gripDragging = false

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
  dom.heroOrg.textContent = state.orgName || 'No org selected'
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

function startCountdowns(sessionResetsAt, weeklyResetsAt) {
  stopCountdowns()

  const tick = () => {
    metricDom.session.reset.textContent = formatReset(sessionResetsAt)
    metricDom.weekly.reset.textContent = formatReset(weeklyResetsAt)
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

function getSeverity(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return 'pending'
  const value = Number(pct)
  if (value >= state.settings.dangerThreshold) return 'danger'
  if (value >= state.settings.warnThreshold) return 'warn'
  return 'healthy'
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function setToneClass(element, tone) {
  if (!element) return
  element.classList.remove('is-pending', 'is-healthy', 'is-warn', 'is-danger', 'is-local', 'is-accent')
  element.classList.add(`is-${tone}`)
}

function setRowTone(row, tone) {
  if (!row) return
  row.classList.remove('tone-pending', 'tone-healthy', 'tone-warn', 'tone-danger', 'tone-local')
  row.classList.add(`tone-${tone}`)
}

function chipLabelForTone(tone) {
  if (tone === 'danger') return 'Critical'
  if (tone === 'warn') return 'Watch'
  if (tone === 'healthy') return 'Healthy'
  if (tone === 'local') return 'Local'
  return 'Pending'
}

function renderRing(progressEl, labelEl, pct, options = {}) {
  const { fallbackLabel = '--' } = options
  if (!progressEl || !labelEl) return

  if (pct == null || Number.isNaN(Number(pct))) {
    progressEl.style.strokeDasharray = '0 100'
    labelEl.textContent = fallbackLabel
    return
  }

  const clamped = Math.max(0, Math.min(100, Number(pct)))
  progressEl.style.strokeDasharray = `${clamped} ${100 - clamped}`
  labelEl.textContent = `${Math.round(clamped)}%`
}

function renderApiMetric(key, pct, resetsAt) {
  const metric = metricDom[key]
  if (!metric) return

  const tone = getSeverity(pct)
  setRowTone(metric.row, tone)
  setToneClass(metric.status, tone)
  metric.status.textContent = chipLabelForTone(tone)

  if (pct == null || Number.isNaN(Number(pct))) {
    metric.pct.textContent = '-'
    metric.bar.style.width = '0%'
    renderRing(metric.ring, metric.ringLabel, null)
    if (!resetsAt) metric.reset.textContent = 'waiting for sync'
    return
  }

  const clamped = Math.max(0, Math.min(100, Number(pct)))
  metric.pct.textContent = `${clamped.toFixed(1)}%`
  metric.bar.style.width = `${clamped}%`
  metric.reset.textContent = formatReset(resetsAt)
  renderRing(metric.ring, metric.ringLabel, clamped)
}

function renderMonthly(local) {
  const metric = metricDom.monthly
  const monthly = local?.monthlyTokens ?? null
  const today = local?.todayTokens ?? null
  const weekly = local?.weeklyTokens ?? null

  setRowTone(metric.row, 'local')
  setToneClass(metric.status, 'local')
  metric.status.textContent = 'Local'
  metric.ringLabel.textContent = '30d'

  if (monthly == null) {
    metric.pct.textContent = '-'
    metric.reset.textContent = 'local stats not found'
    metric.bar.style.width = '0%'
    metric.ring.style.strokeDasharray = '0 100'
    return
  }

  const baselineFloor = Math.max(
    monthly,
    (weekly || 0) * 4.2,
    (today || 0) * 30,
    state.monthlyBaseline,
    1
  )

  state.monthlyBaseline = baselineFloor
  const relativePct = Math.min(100, (monthly / state.monthlyBaseline) * 100)

  metric.pct.textContent = formatTokens(monthly)
  metric.bar.style.width = `${relativePct}%`
  renderRing(metric.ring, metric.ringLabel, relativePct, { fallbackLabel: '30d' })
  metric.ringLabel.textContent = '30d'

  const parts = []
  if (today != null) parts.push(`today ${formatTokens(today)}`)
  if (weekly != null) parts.push(`7d ${formatTokens(weekly)}`)
  metric.reset.textContent = parts.join(' · ')
}

function renderFacts(local) {
  dom.factToday.textContent = formatTokens(local?.todayTokens)
  dom.factWeek.textContent = formatTokens(local?.weeklyTokens)
  dom.factAlltime.textContent = formatTokens(local?.allTimeTokens)
}

function renderSummary(local) {
  dom.alltimeVal.textContent = formatTokens(local?.allTimeTokens)
  dom.alltimeMeta.textContent = local?.modelBreakdown?.length
    ? `${local.modelBreakdown.length} model${local.modelBreakdown.length === 1 ? '' : 's'} tracked`
    : 'No local model totals yet'

  if (local?.firstSessionDate) {
    const first = new Date(local.firstSessionDate)
    dom.trackedSince.textContent = Number.isNaN(first.getTime())
      ? '-'
      : formatShortDate(local.firstSessionDate)

    const totalDays = Math.max(1, Math.ceil((Date.now() - first.getTime()) / 86_400_000))
    dom.trackedMeta.textContent = `${totalDays} day${totalDays === 1 ? '' : 's'} tracked`
  } else {
    dom.trackedSince.textContent = '-'
    dom.trackedMeta.textContent = 'Waiting for local history'
  }

  const top = local?.modelBreakdown?.[0]
  if (!top) {
    dom.topModel.textContent = '-'
    dom.topModelMeta.textContent = 'No local model leader yet'
    return
  }

  dom.topModel.textContent = top.label || top.key || 'Unknown'
  const share = local?.allTimeTokens > 0
    ? Math.round((top.totalTokens / local.allTimeTokens) * 100)
    : null
  const meta = [formatTokens(top.totalTokens)]
  if (share != null && Number.isFinite(share)) meta.push(`${share}% share`)
  dom.topModelMeta.textContent = meta.join(' · ')
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
        <div class="model-bar"><span style="width:${width}%"></span></div>
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

function renderHistoryChart(history) {
  const shouldShow = effectiveDetailsOpen() && !!state.settings.showGraph
  dom.chartBlock.classList.toggle('hidden', !shouldShow)

  if (!shouldShow) {
    dom.chartCanvas.classList.add('hidden')
    dom.chartEmpty.classList.add('hidden')
    return
  }

  const points = buildHistoryPoints(history, 7)
  const hasData = points.some((point) => point.tokens > 0)
  dom.chartEmpty.classList.toggle('hidden', hasData)
  dom.chartCanvas.classList.toggle('hidden', !hasData)

  if (!hasData || typeof window.Chart !== 'function') return

  const styles = getComputedStyle(document.documentElement)
  const accentColor = styles.getPropertyValue('--local').trim()
  const mutedColor = styles.getPropertyValue('--muted').trim()
  const borderColor = styles.getPropertyValue('--border').trim()
  const tooltipBg = styles.getPropertyValue('--panel-solid').trim()
  const textColor = styles.getPropertyValue('--text').trim()

  const ctx = dom.chartCanvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 0, 0, dom.chartCanvas.height || 190)
  gradient.addColorStop(0, accentColor.replace('rgb', 'rgba').replace(')', ', 0.35)'))
  gradient.addColorStop(1, accentColor.replace('rgb', 'rgba').replace(')', ', 0.02)'))

  const config = {
    type: 'line',
    data: {
      labels: points.map((point) => point.label),
      datasets: [{
        data: points.map((point) => point.tokens),
        borderColor: accentColor,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: accentColor,
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

function mascotToneAndCopy(payload) {
  const sessionTone = getSeverity(payload?.api?.sessionPct)
  const weeklyTone = getSeverity(payload?.api?.weeklyPct)
  const rank = { pending: 0, healthy: 1, warn: 2, danger: 3 }
  const winner = rank[sessionTone] >= rank[weeklyTone] ? sessionTone : weeklyTone

  if (winner === 'danger') return { tone: 'danger', label: 'Throttle now' }
  if (winner === 'warn') return { tone: 'warn', label: 'Watch the meter' }
  if (winner === 'healthy') return { tone: 'healthy', label: 'In the clear' }
  if (payload?.local?.allTimeTokens) return { tone: 'local', label: 'Local only' }
  return { tone: 'accent', label: 'Stand by' }
}

function renderHero(payload) {
  dom.heroOrg.textContent = state.orgName || 'No org selected'
  dom.heroUpdated.textContent = payload?.lastUpdated
    ? `Updated ${formatClock(payload.lastUpdated)}`
    : 'Waiting for data'

  const mascot = mascotToneAndCopy(payload)
  setToneClass(dom.mascotStatus, mascot.tone)
  dom.mascotStatus.textContent = mascot.label
}

function renderUsageData(payload) {
  state.usage = payload
  renderHero(payload)
  renderFacts(payload?.local || null)
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
  renderHero(null)
  renderFacts(null)
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

function syncUiFromSettings() {
  syncSettingsForm()
  applyTheme()

  document.body.classList.toggle('compact-mode', !!state.settings.compactMode)
  document.body.classList.toggle('settings-open', !!state.settingsOpen)
  document.body.classList.toggle('details-open', effectiveDetailsOpen())

  dom.usagePanel.classList.toggle('hidden', !!state.settingsOpen)
  dom.settingsPanel.classList.toggle('hidden', !state.settingsOpen)
  dom.detailsPanel.classList.toggle('hidden', !effectiveDetailsOpen())
  dom.chartBlock.classList.toggle('hidden', !effectiveDetailsOpen() || !state.settings.showGraph)

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
  document.body.classList.remove('settings-open')
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

function bindResizeGrip() {
  if (!dom.resizeGrip) return

  const handleMove = (event) => {
    if (!gripDragging) return
    window.api.resizeWindow({ screenX: event.screenX, screenY: event.screenY })
  }

  const stopResize = () => {
    if (!gripDragging) return
    gripDragging = false
    document.body.classList.remove('is-resizing')
    window.api.endWindowResize()
    window.removeEventListener('mousemove', handleMove)
    window.removeEventListener('mouseup', stopResize)
  }

  dom.resizeGrip.addEventListener('mousedown', (event) => {
    event.preventDefault()
    gripDragging = true
    document.body.classList.add('is-resizing')
    window.api.startWindowResize({ screenX: event.screenX, screenY: event.screenY })
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', stopResize)
  })

  window.addEventListener('blur', stopResize)
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
bindResizeGrip()
window.api.getSettings()
showView('loading')
resetUsageUi()
syncActionButtons()
