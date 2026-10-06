import { Monitor, ArrowLeftRight, MonitorX } from 'lucide-react'
import { s } from './roomStyles'

export function ScreenShareBar({ label, hasSecondary, activeSlot, onAddWindow, onSwitch, onStop }: {
  label: string
  hasSecondary: boolean
  activeSlot: 'primary' | 'secondary'
  onAddWindow: () => void
  onSwitch: () => void
  onStop: () => void
}) {
  return (
    <div style={s.shareBar}>
      <div style={s.shareBarLabel}>
        <Monitor size={13} color="#48bb78" />
        <span>{label || 'Sharing screen'}</span>
        {hasSecondary && (
          <span style={s.shareBarSlot}>{activeSlot === 'primary' ? 'Source 1' : 'Source 2'}</span>
        )}
      </div>
      <div style={s.shareBarActions}>
        {!hasSecondary ? (
          <button style={s.shareBarBtn} onClick={onAddWindow}>
            <Monitor size={12} /> Add Window
          </button>
        ) : (
          <button style={{ ...s.shareBarBtn, borderColor: '#5b5ef4' }} onClick={onSwitch}>
            <ArrowLeftRight size={12} /> Switch
          </button>
        )}
        <button style={{ ...s.shareBarBtn, background: '#3d1a1a', borderColor: '#c53030', color: '#e57373' }} onClick={onStop}>
          <MonitorX size={12} /> Stop Sharing
        </button>
      </div>
    </div>
  )
}
