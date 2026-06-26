const { app, BrowserWindow, ipcMain, shell, desktopCapturer, Menu, systemPreferences } = require('electron')
const path = require('path')
const { existsSync, readFileSync } = require('fs')
const { spawn, execFile } = require('child_process')

const isDev = !app.isPackaged

let mainWindow
let backendProcess

// ---------------------------------------------------------------------------
// Load .env and spawn the Express backend as a child process
// ---------------------------------------------------------------------------
function startBackend() {
  // In dev mode, concurrently already starts the backend — don't double-spawn it
  if (isDev) return

  const backendPath = isDev
    ? path.join(__dirname, '..', 'livekit_node_backend.js')
    : path.join(process.resourcesPath, 'app', 'livekit_node_backend.js')

  if (!existsSync(backendPath)) {
    console.warn('[electron] backend not found at', backendPath)
    return
  }

  const envPath = isDev
    ? path.join(__dirname, '..', '.env')
    : path.join(process.resourcesPath, 'app', '.env')

  const env = { ...process.env, PORT: '3001' }

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
  // url = beehive://auth/confirm#access_token=XXX&...
  try {
    const parsed = new URL(url)
    const hash = parsed.hash.slice(1) // strip leading #
    // Token must be in the hash so Supabase's detectSessionInUrl picks it up
    mainWindow.webContents.loadURL(
      isDev
        ? `http://localhost:5173/?auth=confirm#${hash}`
        : `file://${path.join(__dirname, '..', 'dist', 'index.html')}?auth=confirm#${hash}`
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
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  backendProcess?.kill()
})
