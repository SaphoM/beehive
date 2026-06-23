const { app, BrowserWindow, ipcMain, shell, desktopCapturer, Menu, systemPreferences } = require('electron')
const path = require('path')
const { existsSync, readFileSync } = require('fs')
const { spawn } = require('child_process')

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
    },
  })

  // Prevent drag-and-drop from navigating the window to the dropped file URL
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  if (isDev) {
    // Vite dev server — give it a moment to be ready
    await new Promise(r => setTimeout(r, 1500))
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
  return err || null // null = success
})

// ---------------------------------------------------------------------------
// IPC: check / request macOS Screen Recording permission
// ---------------------------------------------------------------------------
ipcMain.handle('get-screen-access-status', () => {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen')
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
// Single-instance lock — must be checked before ANY app lifecycle code
// If we don't get the lock, quit immediately and do nothing else
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

// Only the first instance reaches here
app.on('second-instance', () => {
  // A second launch was attempted — bring our window to focus
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

// ---------------------------------------------------------------------------
// App lifecycle (only runs for the one allowed instance)
// ---------------------------------------------------------------------------
app.whenReady().then(async () => {
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
