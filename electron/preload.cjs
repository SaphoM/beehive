const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,

  // Open a local file path in its native app (Keynote, PowerPoint, Preview…)
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // Get all visible windows + screens as source objects with base64 thumbnails
  getDesktopSources: (opts) => ipcRenderer.invoke('get-desktop-sources', opts),
})
