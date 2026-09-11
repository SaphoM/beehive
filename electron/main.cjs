const { app, BrowserWindow, ipcMain, shell, desktopCapturer, Menu, systemPreferences, screen } = require('electron')
const path = require('path')
const { existsSync, statSync, mkdirSync } = require('fs')
const { spawn, execFile, execFileSync } = require('child_process')
const http = require('http')
const https = require('https')
const updater = require('./updater.cjs')

const isDev = !app.isPackaged

let mainWindow
let dockWindow
let apiProxyServer

// ---------------------------------------------------------------------------
// Local API proxy → hosted BeeHive backend
// ---------------------------------------------------------------------------
// The desktop app used to spawn the full Express backend as a child process,
// which meant shipping .env — including SUPABASE_SERVICE_ROLE_KEY and
// LIVEKIT_API_SECRET — inside the packaged app, where anyone who downloaded
// the installer could read it straight out of Contents/Resources/app/.env.
// Those are admin credentials: the service-role key bypasses every RLS policy
// in the database.
//
// The renderer still talks to http://localhost:3001 exactly as before (so no
// frontend code changes, and no CORS surface has to be opened on the public
// API — several endpoints are deliberately guest-accessible and allowing a
// `null` Origin for them would be worse than this proxy). The difference is
// that :3001 is now a credential-free pass-through to the hosted backend,
// which holds the secrets server-side, the same way the web build has always
// worked.
//
// Bound to 127.0.0.1 explicitly, never 0.0.0.0 — this listener must not be
// reachable from other machines on the network.
const REMOTE_API_ORIGIN = process.env.BEEHIVE_API_ORIGIN || 'https://beehive-fu8w.onrender.com'

function startApiProxy() {
  // Dev runs the real backend locally via `concurrently` (with a .env that
  // never leaves the developer's machine), so leave that path alone.
  if (isDev) return

  const remote = new URL(REMOTE_API_ORIGIN)
  const client = remote.protocol === 'https:' ? https : http

  apiProxyServer = http.createServer((req, res) => {
    // Forward the request verbatim apart from Host, which must name the
    // upstream for TLS/SNI and virtual-host routing to resolve.
    const headers = { ...req.headers, host: remote.host }

    const upstream = client.request({
      protocol: remote.protocol,
      hostname: remote.hostname,
      port: remote.port || (remote.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url,
      headers,
    }, up => {
      res.writeHead(up.statusCode, up.headers)
      up.pipe(res)
    })

    upstream.on('error', err => {
      console.error('[api-proxy] upstream error:', err.message)
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'BeeHive backend unreachable' }))
    })

    // Piping (rather than buffering) keeps large bodies — shared-file uploads,
    // avatar images — streaming instead of held in memory.
    req.pipe(upstream)
  })

  apiProxyServer.on('error', err => console.error('[api-proxy] listen error:', err.message))
  apiProxyServer.listen(3001, '127.0.0.1', () => {
    console.log('[api-proxy] 127.0.0.1:3001 →', REMOTE_API_ORIGIN)
  })
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
  mainWindow.webContents.setWindowOpenHandler(({ frameName, url }) => {
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
    // Non-http(s) URLs (mailto:, tel:, etc. — e.g. SchedulePanel.tsx's "Send
    // Email Invite" button, window.open('mailto:...')) can never render as
    // page content. A real browser hands these to the OS's own protocol
    // handler and never shows a tab for them; Electron's generic 'allow'
    // below has no such special case, so it was spawning a real, blank,
    // permanently-orphaned BrowserWindow for every one of these — the
    // reported "blank window on every scheduled meeting" bug, since
    // inviting attendees by email is a normal part of scheduling. Hand off
    // to shell.openExternal (the same mechanism a browser uses) and deny
    // the window-open request so no window is ever created for it.
    if (!/^https?:\/\//i.test(url)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  // Push OS fullscreen state changes to the renderer (green button, F11, Escape)
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send('fullscreen-change', true))
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send('fullscreen-change', false))

  updater.setMainWindow(mainWindow)

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
// IPC: current installed app version (used by UpdatePrompt in renderer)
// ---------------------------------------------------------------------------
ipcMain.handle('get-app-version', () => app.getVersion())

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
// IPC: open macOS's camera/microphone Privacy settings directly
// Once a user has explicitly denied camera/mic access, neither
// askForMediaAccess() nor a browser's getUserMedia() can ever show that
// permission prompt again — this is deliberate OS/browser security behavior,
// not something an app can override. The only way to change it is the
// Privacy & Security settings pane, so the best an app can do is take the
// user straight there instead of just saying "blocked".
// ---------------------------------------------------------------------------
ipcMain.handle('open-media-privacy-settings', (_, kind) => {
  if (process.platform !== 'darwin') return false
  const pane = kind === 'microphone' ? 'Privacy_Microphone'
    : kind === 'screen' ? 'Privacy_ScreenCapture'
    : 'Privacy_Camera'
  shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
  return true
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
    // Non-activating NSPanel — the load-bearing setting for a control bar
    // floating over another app's full-screen presentation. A normal window
    // ACTIVATES its owning app on mouse-down (before/regardless of
    // acceptsFirstMouse, which only controls whether that same click also
    // reaches the button); activating BeeHive while Keynote/PowerPoint is
    // mid-slideshow makes macOS drop the presentation out of full screen —
    // so every dock click, even mute, was collapsing the show. A panel with
    // the non-activating style mask receives clicks WITHOUT ever activating
    // BeeHive, which is exactly how screen-recorder control bars (Loom
    // etc.) stay clickable over full-screen apps.
    type: 'panel',
    // The panel type alone wasn't enough: a non-activating panel still
    // becomes the KEY WINDOW system-wide when clicked — taking key status
    // away from Keynote's slideshow window without activating BeeHive —
    // and Keynote treats its playback window resigning key as "end the
    // show", so clicks still collapsed the presentation. focusable: false
    // means this window can never become key at all: clicks are delivered
    // purely as mouse events (all any dock button needs — there's no
    // keyboard input here), and the presenting app keeps key status
    // through every interaction.
    focusable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    // Keep the dock out of Mission Control / the Spaces system entirely —
    // one less way for the window manager to associate it with a Space
    // transition when it's interacted with over a full-screen presentation.
    hiddenInMissionControl: true,
    webPreferences: {
      preload: path.join(__dirname, 'dockPreload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // Without this, macOS treats the dock's FIRST click (while it's
      // inactive, which it deliberately always is — see showInactive()
      // below) as just "activate this window", swallowing the click instead
      // of delivering it to the button. That's the exact "not controllable"
      // symptom while a full-screen app (Keynote, PowerPoint) holds focus:
      // every click looked dead because it was only ever waking the window.
      acceptsFirstMouse: true,
    },
  })
  // 'screen-saver' level, not 'floating': full-screen presentation windows
  // (Keynote/PowerPoint slideshows, Preview's full-screen PDF view) stack
  // ABOVE the 'floating' level, which buried the dock exactly when the
  // presenter needed it most — mid-slideshow. visibleOnFullScreen (below)
  // only makes the dock follow onto the full-screen Space; this level is
  // what keeps it on top once there. Same approach screen-annotation
  // overlay tools use.
  dockWindow.setAlwaysOnTop(true, 'screen-saver', 1)
  // skipTransformProcessType is the critical option here: without it,
  // setVisibleOnAllWorkspaces works by TRANSFORMING THE APP'S PROCESS TYPE
  // (regular ⇄ UIElement) under the hood, and that transform is documented
  // to cause app-activation / Space side effects — the exact "interacting
  // with the dock yanks macOS away from the presentation's full-screen
  // Space, which ends the slideshow" failure being fixed. With the skip,
  // the window joins all workspaces without touching the process type.
  dockWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  // Every flag above (panel, non-focusable, hiddenInMissionControl,
  // skipTransformProcessType) turned out NOT to be sufficient on its own in
  // real testing: the dock is still a real on-screen window, and delivering
  // a real OS click event to ANY window — even one that never activates its
  // app or becomes key — was still enough for macOS to drop Keynote's/
  // PowerPoint's true full-screen Space on some systems. The actual fix is
  // below: make the window permanently click-through, so the WindowServer
  // never delivers it a real click at all, and reach its buttons a
  // completely different way (see watchDockClicks()).
  dockWindow.setIgnoreMouseEvents(true)
  dockWindow.loadFile(path.join(__dirname, 'dock.html'))
  dockWindow.on('closed', () => { dockWindow = null; stopDockClickWatcher() })
  return dockWindow
}

// ---------------------------------------------------------------------------
// Click-through dock + native click replay — see the big comment in
// beehive-ctl.m's watch-clicks section for the full "why". Summary: the dock
// window is permanently setIgnoreMouseEvents(true), so the OS never sees a
// real click on it (which is what was dropping full-screen presentations).
// A native helper OBSERVES global clicks (a mouse-only NSEvent global
// monitor — no Accessibility permission needed, and it doesn't consume the
// event, so Keynote/PowerPoint still receives every click completely
// normally in parallel). Whenever one lands inside the dock's current
// bounds, we replay it straight into the SAME window via sendInputEvent —
// Electron delivers that directly to the renderer's DOM, so dock.html's
// existing onclick handlers fire completely unmodified. The window itself
// never touches the OS's real hit-testing/activation path a second time.
// ---------------------------------------------------------------------------
let dockClickWatcher = null

function startDockClickWatcher() {
  if (dockClickWatcher || process.platform !== 'darwin') return
  const bin = beehiveCtlPath()
  if (!bin) { console.warn('[dock] beehive-ctl unavailable — dock clicks will not register'); return }

  dockClickWatcher = spawn(bin, ['watch-clicks'])
  let buf = ''
  dockClickWatcher.stdout.on('data', chunk => {
    buf += chunk.toString('utf8')
    let idx
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx); buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.ready || !dockWindow || dockWindow.isDestroyed()) continue

      // NSEvent screen coords are bottom-left origin; Electron's are
      // top-left origin — flip using the primary display's full height.
      const displayHeight = screen.getPrimaryDisplay().bounds.height
      const screenX = msg.x
      const screenY = displayHeight - msg.y

      const b = dockWindow.getBounds()
      if (screenX < b.x || screenX > b.x + b.width || screenY < b.y || screenY > b.y + b.height) continue

      const localX = Math.round(screenX - b.x)
      const localY = Math.round(screenY - b.y)
      dockWindow.webContents.sendInputEvent({
        type: msg.type === 'down' ? 'mouseDown' : 'mouseUp',
        x: localX, y: localY, button: 'left', clickCount: 1,
      })
    }
  })
  dockClickWatcher.on('exit', () => { dockClickWatcher = null })
  dockClickWatcher.stderr?.on('data', d => console.warn('[watch-clicks]', d.toString()))
}

function stopDockClickWatcher() {
  if (dockClickWatcher) { dockClickWatcher.kill(); dockClickWatcher = null }
}

ipcMain.on('dock-show', () => {
  const w = createDockWindow()
  w.showInactive() // visible without stealing focus from the shared app
  startDockClickWatcher()
})

ipcMain.on('dock-hide', () => {
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.hide()
  stopDockClickWatcher()
})

// Main window's renderer → dock window (mic/cam status, timer, sharing info…)
ipcMain.on('dock-state', (_, state) => {
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.webContents.send('dock-state', state)
})

// Dock window → main window's renderer (toggle-mic, leave, open-chat, …).
// Only 'leave' brings BeeHive's main window forward — the meeting is ending
// anyway, so there's nothing left to protect. 'open-chat'/'open-participants'
// used to do this too, but activating BeeHive while another app (Keynote,
// PowerPoint) holds a true macOS full-screen Space forces the OS to switch
// away from that Space — which looks exactly like "closing" the presentation
// out from under the presenter, mid-slideshow, just to peek at a chat
// message. The state change (opening the panel) still happens either way;
// it's simply visible next time the presenter switches back to BeeHive on
// their own terms, instead of being yanked there involuntarily.
const FOCUS_ON_ACTION = new Set(['leave'])
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
// IPC: exit Keynote's/PowerPoint's slideshow — fired when the user clicks
// Stop Sharing or Leave (the only two dock actions meant to end the
// presentation, per the same rule the click-through/replay fix above exists
// to enforce for every OTHER button). Sends each app its own direct
// AppleScript "stop"/"exit" command — the same permission category as the
// prev/next-slide commands above (a normal Apple Event to a scriptable app,
// not UI-scripting via System Events), so this needs no new permission
// beyond whatever Automation access the user already granted Keynote/
// PowerPoint for slide navigation. Silently no-ops if neither is running,
// or if the exact command name doesn't match a given app version — matches
// presentation-control's existing tolerant, try-wrapped design.
// ---------------------------------------------------------------------------
ipcMain.handle('stop-presentation', () => {
  if (process.platform !== 'darwin') return false
  const script = `
tell application "System Events" to set procs to name of every process
if procs contains "Keynote" then
  try
    tell application "Keynote" to stop the front slideshow
  end try
else if procs contains "Microsoft PowerPoint" then
  try
    tell application "Microsoft PowerPoint" to exit slide show (slide show view of slide show window 1)
  end try
end if`
  return new Promise(resolve => {
    execFile('osascript', ['-e', script], err => {
      if (err) console.warn('[stop-presentation]', err.message)
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

  // Register updater IPC handlers before the window opens so the renderer
  // can call them as soon as the page loads.
  updater.registerIPC()
  // Previously supplied by the bundled .env. It is a public URL (not a
  // secret), so it is defaulted here now that .env is no longer shipped —
  // without this, updater.configure() finds no feed and silently disables
  // auto-updates entirely.
  process.env.UPDATE_FEED_URL = process.env.UPDATE_FEED_URL || `${REMOTE_API_ORIGIN}/updates`
  const updateConfigured = updater.configure()

  startApiProxy()
  await createWindow()

  // Start background update checks after the window is ready.
  if (updateConfigured) updater.scheduleChecks()

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
  apiProxyServer?.close()
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  updater.cleanup()
  apiProxyServer?.close()
  stopDockClickWatcher()
  if (dockWindow && !dockWindow.isDestroyed()) dockWindow.close()
})
