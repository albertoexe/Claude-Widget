'use strict'

/**
 * preload.js - IPC bridge between main process and renderer.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // Auth
  startLogin: () => ipcRenderer.send('auth:start'),
  manualLogin: (key) => ipcRenderer.send('auth:manual-key', key),
  logout: () => ipcRenderer.send('auth:logout'),
  onAuthNeeded: (cb) => ipcRenderer.on('auth:needed', () => cb()),
  onAuthValidating: (cb) => ipcRenderer.on('auth:validating', () => cb()),
  onAuthSuccess: (cb) => ipcRenderer.on('auth:success', (_event, data) => cb(data)),
  onAuthExpired: (cb) => ipcRenderer.on('auth:expired', () => cb()),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  close: () => ipcRenderer.send('window:close'),
  setAlwaysOnTop: (flag) => ipcRenderer.send('window:alwaysOnTop', flag),
  setWindowHeight: (height) => ipcRenderer.send('window:setHeight', height),
  startWindowResize: (payload) => ipcRenderer.send('window:resize-start', payload),
  resizeWindow: (payload) => ipcRenderer.send('window:resize-move', payload),
  endWindowResize: () => ipcRenderer.send('window:resize-end'),

  // Settings
  getSettings: () => ipcRenderer.send('settings:get'),
  saveSettings: (patch) => ipcRenderer.send('settings:save', patch),
  openSettings: () => ipcRenderer.send('settings:open'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  onSettings: (cb) => ipcRenderer.on('settings:response', (_event, data) => cb(data)),
  onSettingsShow: (cb) => ipcRenderer.on('settings:show', () => cb()),
  onCompactChange: (cb) => ipcRenderer.on('compact:change', (_event, value) => cb(value)),

  // Usage data
  onUsage: (cb) => ipcRenderer.on('usage:push', (_event, data) => cb(data)),
  requestUsage: () => ipcRenderer.send('usage:request'),

  // Utility
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
})
