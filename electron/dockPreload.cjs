// ---------------------------------------------------------------------------
// Preload for the floating Control Dock window (electron/dock.html).
// The dock is a SEPARATE renderer process from the main BeeHive window, so it
// cannot touch the LiveKit Room object directly — actions are relayed through
// the main process to the main window's renderer, which performs the real
// mute/leave/etc. and pushes updated state back down to the dock.
// ---------------------------------------------------------------------------
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dockAPI', {
  // Dispatch a control action (toggle-mic, leave, open-chat, …) — relayed to
  // the main window's renderer, which owns the live LiveKit Room connection.
  sendAction: (action) => ipcRenderer.send('dock-action', action),

  // Presentation control is a stateless main-process IPC already used by the
  // main window — the dock can invoke it directly, no relay needed.
  presentationControl: (direction) => ipcRenderer.invoke('presentation-control', direction),

  // Receive consolidated meeting state pushed from the main window (mic/cam
  // status, timer, sharing info, speaking name, connection quality, …).
  onState: (cb) => {
    const handler = (_, state) => cb(state)
    ipcRenderer.on('dock-state', handler)
    return () => ipcRenderer.off('dock-state', handler)
  },
})
