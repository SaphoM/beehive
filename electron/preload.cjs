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

  // Drive the shared window's mouse/keyboard from the BeeHive preview.
  // Coords are normalised [0,1] within the shared video's content area.
  control: {
    begin: (title) => ipcRenderer.invoke('control-begin', title),
    refresh: () => ipcRenderer.invoke('control-refresh'),
    end: () => ipcRenderer.invoke('control-end'),
    move: (nx, ny) => ipcRenderer.invoke('control-move', nx, ny),
    click: (nx, ny, opts) => ipcRenderer.invoke('control-click', nx, ny, opts),
    scroll: (dx, dy) => ipcRenderer.invoke('control-scroll', dx, dy),
    type: (text) => ipcRenderer.invoke('control-type', text),
    key: (key, modifiers) => ipcRenderer.invoke('control-key', key, modifiers),
    accessibility: (prompt) => ipcRenderer.invoke('control-accessibility', prompt),
  },
})
