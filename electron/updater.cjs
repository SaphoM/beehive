'use strict'
// ---------------------------------------------------------------------------
// BeeHive Auto-Update Orchestrator
// ---------------------------------------------------------------------------
// Uses electron-updater (generic provider) against a configurable feed URL.
// Configuration:
//   UPDATE_FEED_URL — HTTPS URL prefix where latest-mac.yml / latest.yml
//                     are served (e.g. https://beehive-fu8w.onrender.com/updates).
//                     Auto-updates are DISABLED if this env var is not set.
//
// IPC channels (main → renderer):   'update-status'  (payload: UpdateStatus)
// IPC channels (renderer → main):   'set-meeting-active', 'download-update',
//                                   'install-update', 'check-for-updates',
//                                   'updater-dismiss'
// ---------------------------------------------------------------------------

const { ipcMain } = require('electron')

// Loaded lazily so main.cjs can always require this file — if electron-updater
// is not installed the configure() call returns false without crashing.
let autoUpdater = null
try {
  autoUpdater = require('electron-updater').autoUpdater
} catch {
  console.warn('[updater] electron-updater not found — auto-updates disabled')
}

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000  // 4 hours
const STARTUP_DELAY_MS  = 15_000               // 15 s after launch

let _mainWindow    = null
let _isInMeeting   = false
let _pendingUpdate = null   // update info waiting to show after meeting ends
let _downloadedWhileInMeeting = false
let _downloadedVersion = null
let _checkTimer    = null
let _configured    = false

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function send(data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send('update-status', data)
  }
}

async function fetchMeta() {
  const feedUrl = process.env.UPDATE_FEED_URL
  if (!feedUrl) return null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const res = await fetch(
      `${feedUrl.replace(/\/$/, '')}/metadata`,
      { signal: ctrl.signal, headers: { Accept: 'application/json' } }
    )
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function setMainWindow(win) {
  _mainWindow = win
}

function setMeetingActive(active) {
  const wasInMeeting = _isInMeeting
  _isInMeeting = active
  if (!active && wasInMeeting) {
    // Meeting just ended — surface any queued notifications
    if (_downloadedWhileInMeeting) {
      _downloadedWhileInMeeting = false
      send({ type: 'ready-to-install', version: _downloadedVersion, pendingMeeting: false })
    } else if (_pendingUpdate) {
      const info = _pendingUpdate
      _pendingUpdate = null
      send(info)
    }
  }
}

function configure() {
  if (!autoUpdater) return false
  const feedUrl = process.env.UPDATE_FEED_URL
  if (!feedUrl) {
    console.log('[updater] UPDATE_FEED_URL not set — auto-updates disabled')
    return false
  }

  autoUpdater.autoDownload      = false  // explicit user confirmation before download
  autoUpdater.allowDowngrade    = false  // block downgrade attacks
  autoUpdater.allowPrerelease   = false
  autoUpdater.autoInstallOnAppQuit = true  // once downloaded, install on next quit

  try {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
  } catch (e) {
    console.error('[updater] setFeedURL failed:', e.message)
    return false
  }

  // --- events ---------------------------------------------------------------

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] checking for update…')
    send({ type: 'checking' })
  })

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] up to date')
    send({ type: 'current' })
  })

  autoUpdater.on('update-available', async (info) => {
    console.log('[updater] update available:', info.version)
    const meta = await fetchMeta()
    const payload = {
      type: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      critical: meta?.critical ?? false,
      minimumVersion: meta?.minimumVersion ?? null,
      notes: Array.isArray(meta?.notes) ? meta.notes : [],
    }

    if (_isInMeeting && !payload.critical) {
      // Non-critical: defer until meeting ends; show a subtle in-meeting hint
      _pendingUpdate = payload
      send({ type: 'in-meeting-deferred', version: info.version })
    } else {
      send(payload)
    }
  })

  autoUpdater.on('download-progress', (p) => {
    send({
      type: 'downloading',
      percent: Math.round(p.percent),
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[updater] downloaded:', info.version)
    _downloadedVersion = info.version
    if (_isInMeeting) {
      _downloadedWhileInMeeting = true
      send({ type: 'ready-to-install', version: info.version, pendingMeeting: true })
    } else {
      send({ type: 'ready-to-install', version: info.version, pendingMeeting: false })
    }
  })

  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err)
    // Suppress common non-actionable errors (offline, feed not configured yet)
    if (!msg.includes('net::') && !msg.includes('ENOTFOUND') && !msg.includes('ECONNREFUSED')) {
      console.error('[updater] error:', msg)
    }
    send({ type: 'error', message: msg })
  })

  _configured = true
  return true
}

function scheduleChecks() {
  if (!_configured) return
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(e =>
      console.warn('[updater] startup check failed:', e.message)
    )
  }, STARTUP_DELAY_MS)

  _checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(e =>
      console.warn('[updater] periodic check failed:', e.message)
    )
  }, CHECK_INTERVAL_MS)
}

// Manual fallback for Restart Now — see install-update handler. Runs a
// detached shell script that waits for this app to die, swaps /Applications'
// BeeHive.app with the one inside the staged zip, strips the quarantine
// xattr (running the extraction from a spawned script inherits no TCC file
// consent), and relaunches. Squirrel's failure mode is a silent no-op, so
// this is purely a safety net.
function applyStagedUpdateManually() {
  try {
    const { app } = require('electron')
    const { spawn } = require('child_process')
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const pendingDir = path.join(os.homedir(), 'Library', 'Caches', 'beehive-updater', 'pending')
    let zip = null
    try {
      zip = fs.readdirSync(pendingDir).filter(f => f.endsWith('.zip'))
        .map(f => path.join(pendingDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
    } catch { /* dir missing */ }
    if (!zip) {
      console.error('[updater] no staged zip found — nothing to fall back to')
      return
    }
    const script = `
#!/bin/bash
pkill -f "/Applications/BeeHive.app" 2>/dev/null
sleep 3
TMP=$(mktemp -d)
ditto -xk "${zip}" "$TMP" || exit 1
xattr -dr com.apple.quarantine "$TMP/BeeHive.app" 2>/dev/null
mv /Applications/BeeHive.app /tmp/BeeHive-old.app 2>/dev/null
mv "$TMP/BeeHive.app" /Applications/
open -a /Applications/BeeHive.app
`
    const scriptPath = path.join(os.tmpdir(), 'beehive-apply-update.sh')
    fs.writeFileSync(scriptPath, script, { mode: 0o755 })
    const child = spawn('/bin/bash', [scriptPath], { detached: true, stdio: 'ignore' })
    child.unref()
    // Let the script outlive us, then die for it.
    setTimeout(() => app.quit(), 500)
  } catch (e) {
    console.error('[updater] manual fallback failed:', e)
  }
}

function registerIPC() {
  ipcMain.on('set-meeting-active', (_, active) => setMeetingActive(!!active))

  ipcMain.handle('download-update', async () => {
    if (!_configured) return { ok: false, error: 'updater not configured' }
    try {
      await autoUpdater.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('install-update', () => {
    if (!_configured) return { ok: false, error: 'updater not configured' }
    try {
      // Try the normal path first — on the CI-built mac app this should spawn
      // Squirrel's ShipIt and swap the bundle. If it silently does nothing
      // (which it did for 1.0.320→1.0.371→1.0.373, shipping a dead button —
      // Squirrel fails to run ShipIt when the app was quarantined/deferred
      // before signing moved, and the error is swallowed), this timeout
      // catches it we fall back to applying the staged zip ourselves.
      // NOTE: var rather than let/const so a throw above still clears below.
      var quitTimer = setTimeout(() => {
        console.warn('[updater] quitAndInstall no-op after 10s — applying staged update manually')
        applyStagedUpdateManually()
      }, 10000)
      quitTimer.unref?.()
      autoUpdater.quitAndInstall(false, true)
      // Quit expected to fire within a few seconds; if we reach this line and
      // the app has NOT exited the timer above becomes the saviour.
      return { ok: true }
    } catch (e) {
      console.error('[updater] quitAndInstall threw:', e)
      applyStagedUpdateManually()
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('check-for-updates', async () => {
    if (!_configured) return { ok: false, error: 'updater not configured' }
    try {
      await autoUpdater.checkForUpdates()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.on('updater-dismiss', () => {
    _pendingUpdate = null
  })
}

function cleanup() {
  if (_checkTimer) { clearInterval(_checkTimer); _checkTimer = null }
}

module.exports = { configure, scheduleChecks, registerIPC, setMainWindow, cleanup }
