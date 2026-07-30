const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Resolve the real filesystem path for a File object (Electron 32+ replaces File.path)
  getFilePath: (file) => webUtils.getPathForFile(file),

  // Open a local file path in its native app (Keynote, PowerPoint, Preview…)
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // Get all visible windows + screens as source objects with base64 thumbnails
  getDesktopSources: (opts) => ipcRenderer.invoke('get-desktop-sources', opts),

  // Check macOS Screen Recording permission ('granted' | 'denied' | 'restricted' | 'not-determined')
  getScreenAccessStatus: () => ipcRenderer.invoke('get-screen-access-status'),

  // Float BeeHive above all other windows (set after opening Keynote/PowerPoint)
  // Call stopFloating() when sharing starts or the modal is cancelled
  stopFloating: () => ipcRenderer.send('stop-floating'),

  // Check & request camera/mic permissions from the main process
  // Returns { camera: 'granted'|'denied'|'restricted'|'not-determined', mic: ... }
  requestMediaPermissions: () => ipcRenderer.invoke('request-media-permissions'),

  // Open macOS's Privacy & Security settings straight to the Camera,
  // Microphone, or Screen Recording pane — the only way to change a
  // permission the user already explicitly denied (see the main-process
  // handler for why).
  openMediaPrivacySettings: (kind) => ipcRenderer.invoke('open-media-privacy-settings', kind),

  // Drive the presenter's slideshow (Keynote / PowerPoint) — 'next' | 'prev'
  presentationControl: (direction) => ipcRenderer.invoke('presentation-control', direction),

  // Exit Keynote's/PowerPoint's slideshow — called on Stop Sharing / Leave.
  stopPresentation: () => ipcRenderer.invoke('stop-presentation'),

  // Native OS fullscreen (toggles macOS fullscreen, not just element fullscreen)
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  getFullscreen: () => ipcRenderer.invoke('get-fullscreen'),
  onFullscreenChange: (cb) => {
    const handler = (_, v) => cb(v)
    ipcRenderer.on('fullscreen-change', handler)
    return () => ipcRenderer.off('fullscreen-change', handler)
  },

  // Bring the shared window's owning app to the foreground (native OS window
  // activation — no input injection, no Accessibility permission). windowId is
  // the CGWindowNumber parsed from the desktopCapturer source id.
  activateSharedWindow: (windowId) => ipcRenderer.invoke('activate-shared-window', windowId),

  // Floating Control Dock (separate always-on-top window, electron/dock.html):
  // shown while presenting a window share so meeting controls stay reachable
  // even when the shared app is in the foreground.
  showDock: () => ipcRenderer.send('dock-show'),
  hideDock: () => ipcRenderer.send('dock-hide'),
  pushDockState: (state) => ipcRenderer.send('dock-state', state),
  onDockAction: (cb) => {
    const handler = (_, action) => cb(action)
    ipcRenderer.on('dock-action', handler)
    return () => ipcRenderer.off('dock-action', handler)
  },

  // -------------------------------------------------------------------------
  // Auto-update API
  // -------------------------------------------------------------------------

  // Subscribe to update lifecycle events from the main process.
  // Callback receives: { type, version?, percent?, notes?, critical?, ... }
  // Returns an unsubscribe function.
  onUpdateStatus: (cb) => {
    const handler = (_, data) => cb(data)
    ipcRenderer.on('update-status', handler)
    return () => ipcRenderer.off('update-status', handler)
  },

  // Returns the installed app version string (e.g. "1.0.246").
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Start downloading the available update (called after user clicks "Update Now").
  downloadUpdate: () => ipcRenderer.invoke('download-update'),

  // Apply the downloaded update and relaunch (called after download completes).
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // Trigger an on-demand update check (e.g. from a Settings panel).
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Dismiss the current update prompt for this session.
  dismissUpdate: () => ipcRenderer.send('updater-dismiss'),

  // Notify the main process when the user enters or leaves a live meeting.
  // Prevents blocking update dialogs from interrupting active calls.
  setMeetingActive: (active) => ipcRenderer.send('set-meeting-active', active),
})
