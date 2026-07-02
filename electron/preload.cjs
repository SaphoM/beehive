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

  // Drive the presenter's slideshow (Keynote / PowerPoint) — 'next' | 'prev'
  presentationControl: (direction) => ipcRenderer.invoke('presentation-control', direction),

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
})
