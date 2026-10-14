import { X, Monitor, ArrowLeftRight, CheckSquare, Square } from 'lucide-react'
import { s } from './roomStyles'

export function ScreenShareMenu({ clearBeforeShare, onToggleClear, onEntireScreen, onSelectWindow, onClose }: {
  clearBeforeShare: boolean
  onToggleClear: () => void
  onEntireScreen: () => void
  onSelectWindow: () => void
  onClose: () => void
}) {
  return (
    <div style={{ ...s.shareMenu, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' as const }}>
      <div style={s.shareMenuHeader}>
        <span style={s.shareMenuTitle}>Share Screen</span>
        <button style={s.shareMenuClose} onClick={onClose}><X size={14} /></button>
      </div>

      {!window.electronAPI && (
        <button style={s.shareMenuRow} onClick={onToggleClear}>
          {clearBeforeShare
            ? <CheckSquare size={14} color="#f5a623" />
            : <Square size={14} color="#555" />}
          <span style={{ ...s.shareMenuText, color: clearBeforeShare ? '#f5a623' : '#888' }}>
            Clear screen before sharing
          </span>
        </button>
      )}

      <div style={s.shareMenuDivider} />

      <button style={s.shareMenuOption} onClick={onEntireScreen}>
        <Monitor size={15} color="#aaa" />
        <span>Entire Screen</span>
      </button>

      <button style={s.shareMenuOption} onClick={onSelectWindow}>
        <ArrowLeftRight size={15} color="#aaa" />
        <span>Select Window</span>
      </button>
    </div>
  )
}
