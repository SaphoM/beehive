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
})
