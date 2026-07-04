const { app, BrowserWindow, ipcMain, shell, desktopCapturer, Menu, systemPreferences, screen } = require('electron')
const path = require('path')
const { existsSync, readFileSync, statSync, mkdirSync } = require('fs')
const { spawn, execFile, execFileSync } = require('child_process')

const isDev = !app.isPackaged

let mainWindow
let dockWindow
let backendProcess

// ---------------------------------------------------------------------------
// Load .env and spawn the Express backend as a child process
// ---------------------------------------------------------------------------
function startBackend() {
  // In dev mode, concurrently already starts the backend — don't double-spawn it
  if (isDev) return

  // Packaged: run the esbuild-bundled backend (all deps inlined into one .mjs)
  // — the raw livekit_node_backend.js can't resolve express/livekit-server-sdk
  // from a spawned node process, since those node_modules only exist inside
  // app.asar which pure Node can't read. (Dev returns above; this path is
  // packaged-only.)
  const backendPath = path.join(process.resourcesPath, 'app', 'backend.bundle.mjs')

  if (!existsSync(backendPath)) {
    console.warn('[electron] backend not found at', backendPath)
    return
  }

  const envPath = isDev
    ? path.join(__dirname, '..', '.env')
    : path.join(process.resourcesPath, 'app', '.env')

  // In a packaged app, process.execPath is the Electron/BeeHive binary, not
  // node. ELECTRON_RUN_AS_NODE makes that binary run the backend script with
  // Electron's bundled Node runtime instead of booting a second app window —
  // without it the "backend" launches as Electron, exits immediately (code 0),
  // never binds :3001, and every "Start Meeting" hangs on "Starting…".
  const env = { ...process.env, PORT: '3001', ELECTRON_RUN_AS_NODE: '1' }

  if (existsSync(envPath)) {
    readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const eq = line.indexOf('=')
      if (eq < 1) return
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key && !key.startsWith('#')) env[key] = val
    })
  }

  backendProcess = spawn(process.execPath, [backendPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backendProcess.stdout.on('data', d => console.log('[backend]', d.toString().trim()))
  backendProcess.stderr.on('data', d => console.error('[backend]', d.toString().trim()))
  backendProcess.on('exit', code => console.log('[backend] exited with code', code))
}

// ---------------------------------------------------------------------------
// Create the main BrowserWindow
// ---------------------------------------------------------------------------
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // prevent black screen when another app takes focus
    },
  })

  // Prevent drag-and-drop from navigating the window to the dropped file URL
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  // Allow window.open() (used by the "Pop out" presentation viewer) to spawn a
  // real native child window instead of being blocked by Electron's default deny
  mainWindow.webContents.setWindowOpenHandler(({ frameName }) => {
    if (frameName === 'beehive-popout') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 720,
          backgroundColor: '#060606',
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false },
        },
      }
    }
    return { action: 'allow' }
  })

  // Push OS fullscreen state changes to the renderer (green button, F11, Escape)
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('fullscreen-change', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('fullscreen-change', false))

  if (isDev) {
    // Poll until the Vite dev server is actually responding
    const http = require('http')
    await new Promise(r => {
      const check = () => {
        http.get('http://localhost:5173', res => { res.resume(); r() })
          .on('error', () => setTimeout(check, 200))
      }
      check()
    })
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

// ---------------------------------------------------------------------------
// IPC: open a file in its native macOS / Windows application
// ---------------------------------------------------------------------------
ipcMain.handle('open-file', async (_, filePath) => {
  const err = await shell.openPath(filePath)
  // After launching the native app, float BeeHive above it so the user
  // can still see and click "Share Presentation"
  if (!err && mainWindow) {
    mainWindow.setAlwaysOnTop(true, 'floating')
    mainWindow.focus()
  }
  return err || null // null = success
})

// ---------------------------------------------------------------------------
// IPC: stop floating BeeHive above other windows (called when sharing starts or is cancelled)
// ---------------------------------------------------------------------------
ipcMain.on('stop-floating', () => {
  mainWindow?.setAlwaysOnTop(false)
})

// ---------------------------------------------------------------------------
// IPC: check / request macOS Screen Recording permission
// ---------------------------------------------------------------------------
ipcMain.handle('get-screen-access-status', () => {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen')
})

// ---------------------------------------------------------------------------
// IPC: check & request camera + mic permissions from the main process
// Called by renderer after window loads so the dialog appears in context
// ---------------------------------------------------------------------------
ipcMain.handle('request-media-permissions', async () => {
  if (process.platform !== 'darwin') return { camera: 'granted', mic: 'granted' }
  const camStatus = systemPreferences.getMediaAccessStatus('camera')
  const micStatus = systemPreferences.getMediaAccessStatus('microphone')
  console.log('[permissions] camera:', camStatus, 'mic:', micStatus)
  const results = { camera: camStatus, mic: micStatus }
  if (camStatus === 'not-determined') {
    results.camera = (await systemPreferences.askForMediaAccess('camera')) ? 'granted' : 'denied'
    console.log('[permissions] camera after ask:', results.camera)
  }
  if (micStatus === 'not-determined') {
    results.mic = (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
    console.log('[permissions] mic after ask:', results.mic)
  }
  return results
})

// ---------------------------------------------------------------------------
// IPC: list available windows + screens for screen sharing
// Returns sanitised objects (NativeImage can't cross the context bridge)
// ---------------------------------------------------------------------------
ipcMain.handle('get-desktop-sources', async (_, opts = {}) => {
  try {
    const sources = await desktopCapturer.getSources({
      types: opts.types ?? ['window', 'screen'],
      thumbnailSize: opts.thumbnailSize ?? { width: 320, height: 180 },
      fetchWindowIcons: true,
    })
    return sources
      .filter(s => s.name && s.name !== 'BeeHive')
      .map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
        appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
        display_id: s.display_id,
      }))
  } catch (e) {
    console.error('[electron] desktopCapturer error:', e)
    return []
  }
})

// ---------------------------------------------------------------------------
// IPC: native OS fullscreen toggle (web requestFullscreen only fills the window;
// this toggles the actual macOS / Windows fullscreen mode)
// ---------------------------------------------------------------------------
ipcMain.handle('toggle-fullscreen', () => {
  if (!mainWindow) return false
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  return next
})

ipcMain.handle('get-fullscreen', () => mainWindow?.isFullScreen() ?? false)

// ---------------------------------------------------------------------------
// IPC: bring the shared window's owning app to the foreground. Native OS
// window activation only (NSRunningApplication) — no input injection, so no
// Accessibility permission is needed. Compiled on demand in dev; shipped via
// extraResources in packaged builds.
// ---------------------------------------------------------------------------
function beehiveCtlPath() {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'beehive-ctl')
    if (existsSync(packaged)) return packaged
  }
  const src = path.join(__dirname, 'beehive-ctl.m')
  const bin = path.join(__dirname, 'bin', 'beehive-ctl')
  try {
    const stale = !existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs
    if (stale) {
      mkdirSync(path.dirname(bin), { recursive: true })
      execFileSync('clang', ['-fobjc-arc', '-O2', '-framework', 'AppKit', '-framework', 'ApplicationServices', '-o', bin, src], { stdio: 'ignore' })
    }
  } catch (e) {
    console.warn('[beehive-ctl] build failed:', e.message)
  }
  return existsSync(bin) ? bin : null
}

ipcMain.handle('activate-shared-window', (_, windowId) => {
  return new Promise(resolve => {
    if (process.platform !== 'darwin') { resolve({ ok: false, reason: 'unsupported-platform' }); return }
    const bin = beehiveCtlPath()
    if (!bin) { resolve({ ok: false, reason: 'helper-unavailable' }); return }
    execFile(bin, ['activate-window', String(windowId)], (err, stdout) => {
      try { resolve(JSON.parse((stdout || '').trim())) }
      catch { resolve({ ok: false, reason: err ? 'error' : 'bad-output' }) }
    })
  })
})

// ---------------------------------------------------------------------------
// Floating Control Dock — a separate always-on-top window showing the core
// meeting controls (mic, cam, hand, chat, participants, leave, stop-share,
// slide nav) so the presenter never loses access to them while the shared
// window/app is in the foreground and BeeHive's main window is backgrounded.
//
// It is a SEPARATE renderer process, so it cannot touch the LiveKit Room
// object directly. Actions dispatched from the dock are relayed through this
// main process to the main window's renderer (which owns the live Room
// connection); state updates flow the same way in reverse.
// ---------------------------------------------------------------------------
function createDockWindow() {
  if (dockWindow && !dockWindow.isDestroyed()) return dockWindow

  const display = screen.getPrimaryDisplay()
  // Comfortably fits every control (timer, sharing label + Stop, mic/cam/hand,
  // slide nav, speaking name + quality dot, chat/participants, leave) without
  // clipping. Clamped to the screen width as a second safety net — the dock's
  // own CSS also scrolls horizontally if content is ever wider than this.
  const height = 56
  const width = Math.min(860, display.workArea.width - 40)
  const x = Math.round(display.workArea.x + (display.workArea.width - width) / 2)
  const y = Math.round(display.workArea.y + display.workArea.height - height - 28)

  dockWindow = new BrowserWindow({
    width, height, x, y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'dockPreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  dockWindow.setAlwaysOnTop(true, 'floating')
  dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  dockWindow.loadFile(path.join(__dirname, 'dock.html'))
  dockWindow.on('closed', () => { dockWindow = null })
  return dockWindow
}

ipcMain.on('dock-show', () => {
  const w = createDockWindow()
  w.showInactive() // visible without stealing focus from the shared app
})

ipcMain.on('dock-hide', () => {
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.hide()
})

// Main window's renderer → dock window (mic/cam status, timer, sharing info…)
ipcMain.on('dock-state', (_, state) => {
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.webContents.send('dock-state', state)
})

// Dock window → main window's renderer (toggle-mic, leave, open-chat, …).
// Actions that need the presenter to actually SEE something (chat,
// participants, leaving) also bring BeeHive's main window forward; pure
// background actions (mute, raise hand, stop share) don't steal focus so the
// presenter can keep looking at the shared app.
const FOCUS_ON_ACTION = new Set(['open-chat', 'open-participants', 'leave'])
ipcMain.on('dock-action', (_, action) => {
  if (FOCUS_ON_ACTION.has(action?.type) && mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
  mainWindow?.webContents.send('dock-action', action)
})

// ---------------------------------------------------------------------------
// IPC: drive the presenter's slideshow (next / previous slide).
// Uses AppleScript so it works even while BeeHive is the front window — no
// native key-injection module required. Targets Keynote first, then
// PowerPoint. macOS only; needs Automation permission (prompted on first use).
// ---------------------------------------------------------------------------
ipcMain.handle('presentation-control', (_, direction) => {
  if (process.platform !== 'darwin') return false
  const keynote = direction === 'prev' ? 'show previous' : 'show next'
  const ppt = direction === 'prev' ? 'go to previous slide' : 'go to next slide'
  const script = `
tell application "System Events" to set procs to name of every process
if procs contains "Keynote" then
  try
    tell application "Keynote" to ${keynote}
  end try
else if procs contains "Microsoft PowerPoint" then
  try
    tell application "Microsoft PowerPoint" to ${ppt} (slide show view of slide show window 1)
  end try
end if`
  return new Promise(resolve => {
    execFile('osascript', ['-e', script], err => {
      if (err) console.warn('[presentation-control]', err.message)
      resolve(!err)
    })
  })
})

// ---------------------------------------------------------------------------
// beehive:// deep-link — intercept Supabase magic-link redirect in Electron
// Supabase sends the user to beehive://auth/confirm#access_token=...
// We parse the hash and navigate the renderer to /?auth=confirm&... so the
// Supabase JS client picks up the session automatically.
// ---------------------------------------------------------------------------
app.setAsDefaultProtocolClient('beehive')

function handleDeepLink(url) {
  if (!mainWindow || !url) return
  // url = beehive://auth/confirm#access_token=XXX...  (implicit flow)
  //   or beehive://auth/confirm?code=XXX             (PKCE / other providers)
  try {
    const parsed = new URL(url)
    const hash = parsed.hash // includes leading '#', or '' — forwarded verbatim
    // Carry any query params through too (e.g. a PKCE ?code=). Merge our own
    // auth=confirm marker in so AuthGate treats it as a callback. Forwarding
    // *both* query and hash means the session is established regardless of
    // which flow Supabase used; previously the query was dropped, so a link
    // that came back as ?code=… lost its payload and fell to the sign-in screen.
    const query = new URLSearchParams(parsed.search)
    query.set('auth', 'confirm')
    const suffix = `?${query.toString()}${hash}`
    mainWindow.webContents.loadURL(
      isDev
        ? `http://localhost:5173/${suffix}`
        : `file://${path.join(__dirname, '..', 'dist', 'index.html')}${suffix}`
    )
    mainWindow.show()
    mainWindow.focus()
  } catch (e) {
    console.warn('[deep-link] Failed to parse URL:', url, e.message)
  }
}

// ---------------------------------------------------------------------------
// Single-instance lock — must be checked before ANY app lifecycle code
// If we don't get the lock, quit immediately and do nothing else
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Only the first instance reaches here
app.on('second-instance', (_event, argv) => {
  // On Windows, the deep link URL arrives in argv
  const deepLink = argv.find(arg => arg.startsWith('beehive://'))
  if (deepLink) {
    handleDeepLink(deepLink)
  } else if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// macOS: deep-link arrives via 'open-url' event (single instance already running)
app.on('open-url', (_event, url) => {
  _event.preventDefault()
  handleDeepLink(url)
})

// ---------------------------------------------------------------------------
// App lifecycle (only runs for the one allowed instance)
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
  // Allow camera/mic/screen permission requests from the renderer to pass through
  // to macOS TCC. Must be set before any window loads.
  const { session } = require('electron')
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
    callback(true)
  })
  session.defaultSession.setPermissionCheckHandler(() => true)

  startBackend()
  await new Promise(r => setTimeout(r, 800)) // let backend bind to :3001
  await createWindow()

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ])
  )
})

app.on('window-all-closed', () => {
  backendProcess?.kill()
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  backendProcess?.kill()
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.close()
})
