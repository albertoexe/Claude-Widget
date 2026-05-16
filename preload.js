'use strict'

/**
 * preload.js — IPC bridge between main process and renderer.
 * contextIsolation: true, so we use contextBridge.
 * Only expose what the renderer actually needs — nothing more.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── Auth ────────────────────────────────────────────────────────────────
  /** Open the login BrowserWindow (auto-detect flow) */
  startLogin: () => ipcRenderer.send('auth:start'),

  /** Inject a session key manually (advanced users) */
  manualLogin: (key) => ipcRenderer.send('auth:manual-key', key),

  /** Log out and clear stored credentials */
  logout: () => ipcRenderer.send('auth:logout'),

  /** Main → renderer: no stored credentials found, show login */
  onAuthNeeded: (cb) => ipcRenderer.on('auth:needed', () => cb()),

  /** Main → renderer: session captured, validating with API */
  onAuthValidating: (cb) => ipcRenderer.on('auth:validating', () => cb()),

  /** Main → renderer: session valid, org resolved */
  onAuthSuccess: (cb) =>
    ipcRenderer.on('auth:success', (_e, data) => cb(data)),

  /** Main → renderer: session expired or invalid */
  onAuthExpired: (cb) => ipcRenderer.on('auth:expired', () => cb()),

  // ── Window controls ──────────────────────────────────────────────────────
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setAlwaysOnTop: (flag) => ipcRenderer.send('window:alwaysOnTop', flag),

  // ── Settings ─────────────────────────────────────────────────────────────
  getSettings: () => ipcRenderer.send('settings:get'),
  onSettings: (cb) =>
    ipcRenderer.on('settings:response', (_e, data) => cb(data)),
  saveSettings: (patch) => ipcRenderer.send('settings:save', patch),

  // ── Usage data ───────────────────────────────────────────────────────────
  /** Main → renderer: fresh usage data */
  onUsage: (cb) =>
    ipcRenderer.on('usage:push', (_e, data) => cb(data)),

  /** Renderer → main: request an immediate refresh */
  requestUsage: () => ipcRenderer.send('usage:request'),

  // ── Utility ──────────────────────────────────────────────────────────────
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
