import { useEffect, useRef } from 'react'
import type { DeviceReadiness, DeviceStatus } from './useDeviceReadiness'

// ============================================================
// DeviceReadinessBanner — compact pre-join device status strip
// ============================================================
// Shown in the Lobby (above the join button) and in WaitingRoom
// (below the card while the user waits to be admitted).
//
// Rules:
//  • Nothing renders while still loading.
//  • Nothing renders when all three devices are 'ok' AND the
//    user has previously passed a check ('beehive:drPassed').
//  • Otherwise shows one row per non-ok device plus a "Speakers"
//    row whenever the speaker status is anything but 'ok'.
//  • Marks 'beehive:drPassed' once all three reach 'ok' for the
//    first time — returning users with healthy devices see nothing.
//
// No calls to getUserMedia — detection is read-only.

const PASSED_KEY = 'beehive:drPassed'

type RowStatus = 'ok' | 'warn' | 'error'

interface Row {
  label: string
  detail: string
  status: RowStatus
  action?: { label: string; onClick: () => void }
}

const DOT: Record<RowStatus, string> = { ok: '#48bb78', warn: '#f5a623', error: '#e57373' }
const DOT_LABEL: Record<RowStatus, string> = { ok: '●', warn: '●', error: '●' }

function deviceStatusToRow(status: DeviceStatus): RowStatus {
  if (status === 'ok') return 'ok'
  if (status === 'missing') return 'error'
  if (status === 'blocked') return 'error'
  return 'warn'
}

function openSettings(kind: 'microphone' | 'camera') {
  if ((window as any).electronAPI?.openMediaPrivacySettings) {
    (window as any).electronAPI.openMediaPrivacySettings(kind)
  }
  // Web: no universal cross-browser deep link — instruct via the UI
}

export function DeviceReadinessBanner({ readiness }: { readiness: DeviceReadiness }) {
  const { loading, mic, camera, speaker } = readiness
  // 'unknown' speaker means the browser won't enumerate output devices until
  // mic permission is granted — not an actual fault, so it must not keep the
  // banner permanently open (see useDeviceReadiness).
  const speakerFault = speaker === 'missing' || speaker === 'blocked'
  const allOk = mic === 'ok' && camera === 'ok' && !speakerFault
  const passedRef = useRef(false)

  // Mark first-pass once everything is green
  useEffect(() => {
    if (allOk && !passedRef.current) {
      passedRef.current = true
      try { localStorage.setItem(PASSED_KEY, '1') } catch { /* storage unavailable */ }
    }
  }, [allOk])

  if (loading) return null

  // Returning user, all devices healthy → show nothing
  const hasPassed = (() => { try { return !!localStorage.getItem(PASSED_KEY) } catch { return false } })()
  if (allOk && hasPassed) return null

  // Build rows — only for non-ok states (plus camera which shows as warn when missing)
  const rows: Row[] = []

  // Speaker — only a real fault, never the withheld-enumeration 'unknown'
  if (speakerFault) {
    rows.push({
      label: 'Speakers',
      detail: speaker === 'missing' ? 'No audio output device found' : 'Speaker access blocked',
      status: 'error',
      action: speaker === 'blocked' ? {
        label: (window as any).electronAPI ? 'Open System Settings' : 'See browser address bar',
        onClick: () => openSettings('microphone'),
      } : undefined,
    })
  }

  // Mic
  if (mic === 'blocked') {
    rows.push({
      label: 'Microphone',
      detail: 'Permission denied',
      status: 'error',
      action: {
        label: (window as any).electronAPI ? 'Open System Settings' : 'Click address bar icon',
        onClick: () => openSettings('microphone'),
      },
    })
  } else if (mic === 'missing') {
    rows.push({
      label: 'Microphone',
      detail: 'No microphone found — check connections',
      status: 'error',
    })
  }

  // Camera — warn only (non-critical; user can join without video)
  if (camera === 'blocked') {
    rows.push({
      label: 'Camera',
      detail: 'Permission denied — you\'ll join without video',
      status: 'warn',
      action: {
        label: (window as any).electronAPI ? 'Open System Settings' : 'Click address bar icon',
        onClick: () => openSettings('camera'),
      },
    })
  } else if (camera === 'missing') {
    rows.push({
      label: 'Camera',
      detail: 'No camera found — you\'ll join without video',
      status: 'warn',
    })
  }

  // If all ok (first time) — show a single green "all good" row then hide after pass
  if (rows.length === 0 && allOk) {
    rows.push({ label: 'Audio & Camera', detail: 'Everything looks good', status: 'ok' })
  }

  if (rows.length === 0) return null

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 5,
      padding: '8px 10px',
      background: '#111', border: '1px solid #222', borderRadius: 8,
      fontFamily: "'Roboto', sans-serif",
    }}>
      {rows.map((row, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ color: DOT[row.status], fontSize: 8, lineHeight: 1 }}>{DOT_LABEL[row.status]}</span>
          <span style={{ color: '#aaa', fontSize: 11, fontWeight: 500, minWidth: 68 }}>{row.label}</span>
          <span style={{ color: '#555', fontSize: 11, flex: 1 }}>{row.detail}</span>
          {row.action && (
            <button
              onClick={row.action.onClick}
              style={{
                background: 'none', border: '1px solid #2a2a2a', borderRadius: 5,
                color: '#888', fontSize: 10, cursor: 'pointer', padding: '2px 8px',
                fontFamily: "'Roboto', sans-serif", flexShrink: 0,
              }}
            >
              {row.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
