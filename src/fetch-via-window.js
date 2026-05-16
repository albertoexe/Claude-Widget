'use strict'

/**
 * fetchViaWindow — load a URL inside a hidden BrowserWindow so that Cloudflare
 * sees a real browser request (with session cookies from the `persist:claude`
 * partition) instead of a bare Node/fetch call which gets blocked.
 *
 * Usage (main process only):
 *   const { fetchViaWindow } = require('./src/fetch-via-window')
 *   const data = await fetchViaWindow('https://claude.ai/api/organizations')
 */

const { BrowserWindow } = require('electron')

const PARTITION = 'persist:claude'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * @param {string} url          - Full URL to fetch (claude.ai/api/* only)
 * @param {object} [opts]
 * @param {number} [opts.timeout=30000] - ms before rejecting
 * @returns {Promise<any>}       - Parsed JSON body
 */
async function fetchViaWindow(url, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: PARTITION   // shares session cookies with the login window
      }
    })

    const timer = setTimeout(() => {
      win.destroy()
      reject(new Error(`fetchViaWindow timeout after ${timeout}ms — ${url}`))
    }, timeout)

    win.webContents.on('did-finish-load', async () => {
      try {
        const body = await win.webContents.executeJavaScript(
          'document.body.innerText'
        )
        clearTimeout(timer)
        win.destroy()

        // Detect Cloudflare challenge pages
        if (
          body.includes('Just a moment') ||
          body.includes('Enable JavaScript') ||
          body.includes('cf-browser-verification')
        ) {
          return reject(new Error('Cloudflare block — session may be invalid'))
        }

        resolve(JSON.parse(body))
      } catch (e) {
        clearTimeout(timer)
        if (!win.isDestroyed()) win.destroy()
        reject(new Error(`fetchViaWindow parse error: ${e.message}`))
      }
    })

    win.webContents.on('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
      reject(new Error(`fetchViaWindow load failed [${code}]: ${desc}`))
    })

    win.loadURL(url, { userAgent: USER_AGENT })
  })
}

module.exports = { fetchViaWindow }
