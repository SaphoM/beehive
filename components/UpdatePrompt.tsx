import { useEffect, useReducer, useRef } from 'react'

// ---------------------------------------------------------------------------
// UpdatePrompt — desktop auto-update notification for BeeHive
// ---------------------------------------------------------------------------
// Rendered at the root (src/main.tsx) so it overlays every view.
// It is a no-op in web mode: all electronAPI calls are guarded.
//
// State machine:
//   idle → checking → current
//                   → available → downloading → ready-to-install
//                               → dismissed
//                               → skipped
//   in-meeting-deferred → (surfaced after meeting ends by main process)
//
// localStorage:
//   beehive:skippedVersions — JSON array of version strings the user opted out of
// ---------------------------------------------------------------------------

const SKIP_KEY = 'beehive:skippedVersions'
const ACCENT   = '#f5a623'
const RED      = '#e05252'

// ---- Types -----------------------------------------------------------------

interface UpdateInfo {
  version: string
  releaseDate?: string
  critical: boolean
  notes: string[]
  minimumVersion: string | null
}

type Phase =
  | { tag: 'idle' }
  | { tag: 'checking' }
  | { tag: 'current' }
  | { tag: 'available'; info: UpdateInfo }
  | { tag: 'downloading'; percent: number; total: number }
  | { tag: 'ready'; version: string; pendingMeeting: boolean }
  | { tag: 'in-meeting'; version: string }
  | { tag: 'dismissed' }
  | { tag: 'error'; message: string }

type Action =
  | { type: 'status'; payload: any }
  | { type: 'dismiss' }
  | { type: 'skip'; version: string }

// ---- Reducer ---------------------------------------------------------------

function skippedVersions(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SKIP_KEY) || '[]')) } catch { return new Set() }
}

function addSkip(version: string) {
  try {
    const s = skippedVersions(); s.add(version)
    localStorage.setItem(SKIP_KEY, JSON.stringify([...s]))
  } catch { /* storage unavailable */ }
}

function reduce(phase: Phase, action: Action): Phase {
  if (action.type === 'dismiss') return { tag: 'dismissed' }
  if (action.type === 'skip') { addSkip(action.version); return { tag: 'dismissed' } }

  const p = action.payload
  switch (p.type) {
    case 'checking':
      return { tag: 'checking' }
    case 'current':
      return { tag: 'current' }
    case 'available': {
      if (skippedVersions().has(p.version)) return { tag: 'dismissed' }
      return {
        tag: 'available',
        info: {
          version: p.version,
          releaseDate: p.releaseDate,
          critical: !!p.critical,
          notes: p.notes || [],
          minimumVersion: p.minimumVersion || null,
        },
      }
    }
    case 'in-meeting-deferred':
      return { tag: 'in-meeting', version: p.version }
    case 'downloading':
      return { tag: 'downloading', percent: p.percent ?? 0, total: p.total ?? 0 }
    case 'ready-to-install':
      return { tag: 'ready', version: p.version, pendingMeeting: !!p.pendingMeeting }
    case 'error':
      // Suppress transient network errors silently
      return phase.tag === 'available' || phase.tag === 'downloading' || phase.tag === 'ready'
        ? phase
        : { tag: 'idle' }
    default:
      return phase
  }
}

// ---- Component -------------------------------------------------------------

export function UpdatePrompt() {
  const api = (window as any).electronAPI
  if (!api?.onUpdateStatus) return null   // web mode — nothing to do

  const [phase, dispatch] = useReducer(reduce, { tag: 'idle' })
  const downloadingRef = useRef(false)

  useEffect(() => {
    const unsub = api.onUpdateStatus((data: any) => {
      dispatch({ type: 'status', payload: data })
    })
    return unsub
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const startDownload = async () => {
    if (downloadingRef.current) return
    downloadingRef.current = true
    dispatch({ type: 'status', payload: { type: 'downloading', percent: 0, total: 0 } })
    const result = await api.downloadUpdate?.()
    if (result && !result.ok) {
      downloadingRef.current = false
      dispatch({ type: 'status', payload: { type: 'error', message: result.error } })
    }
  }

  const dismiss = () => {
    api.dismissUpdate?.()
    dispatch({ type: 'dismiss' })
  }

  const skip = (version: string) => {
    api.dismissUpdate?.()
    dispatch({ type: 'skip', version })
  }

  const install = () => { api.installUpdate?.() }

  // Nothing to show
  if (phase.tag === 'idle' || phase.tag === 'current' || phase.tag === 'checking' || phase.tag === 'dismissed') {
    return null
  }

  // ── Subtle in-meeting chip (non-blocking) ──────────────────────────────────
  if (phase.tag === 'in-meeting') {
    return <InMeetingBadge version={phase.version} critical={false} />
  }
  if (phase.tag === 'ready' && phase.pendingMeeting) {
    return <InMeetingBadge version={phase.version} critical={false} ready />
  }

  // ── Full update card ───────────────────────────────────────────────────────
  return (
    <div style={card}>
      <style>{ANIM}</style>

      {/* ── Available ────────────────────────────────────────────────── */}
      {phase.tag === 'available' && (
        <>
          <Header critical={phase.info.critical} version={phase.info.version} />
          {phase.info.notes.length > 0 && (
            <ul style={notesList}>
              {phase.info.notes.map((n, i) => (
                <li key={i} style={noteItem}>{n}</li>
              ))}
            </ul>
          )}
          <div style={btnRow}>
            <Btn primary label="Update Now" onClick={startDownload} />
            <Btn label="Later" onClick={dismiss} />
            {!phase.info.critical && (
              <Btn label="Skip" onClick={() => skip(phase.info.version)} />
            )}
          </div>
        </>
      )}

      {/* ── Downloading ──────────────────────────────────────────────── */}
      {phase.tag === 'downloading' && (
        <>
          <div style={{ ...headerRow }}>
            <span style={dot(ACCENT)} />
            <span style={title}>Downloading update…</span>
          </div>
          <ProgressBar percent={phase.percent} />
          <span style={subtext}>
            {phase.percent}%{phase.total > 0 ? ` of ${formatBytes(phase.total)}` : ''}
          </span>
        </>
      )}

      {/* ── Ready to install ─────────────────────────────────────────── */}
      {phase.tag === 'ready' && !phase.pendingMeeting && (
        <>
          <div style={headerRow}>
            <span style={dot('#48bb78')} />
            <span style={title}>BeeHive {phase.version} is ready</span>
          </div>
          <p style={subtext}>Restart to apply the update.</p>
          <div style={btnRow}>
            <Btn primary label="Restart Now" onClick={install} />
            <Btn label="Later" onClick={dismiss} />
          </div>
        </>
      )}

      {/* ── Error (transient, dismissible) ───────────────────────────── */}
      {phase.tag === 'error' && (
        <>
          <div style={headerRow}>
            <span style={dot(RED)} />
            <span style={title}>Update check failed</span>
          </div>
          <p style={{ ...subtext, color: '#888' }}>Will retry automatically.</p>
          <div style={btnRow}><Btn label="Dismiss" onClick={dismiss} /></div>
        </>
      )}
    </div>
  )
}

// ---- Sub-components --------------------------------------------------------

function Header({ critical, version }: { critical: boolean; version: string }) {
  return (
    <div style={{ ...headerRow, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={dot(critical ? RED : ACCENT)} />
        <span style={title}>BeeHive {version} is available</span>
      </div>
      {critical && (
        <span style={{ fontSize: 11, color: RED, paddingLeft: 20, fontWeight: 500 }}>
          Critical update — includes important fixes
        </span>
      )}
    </div>
  )
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div style={{ width: '100%', height: 4, background: '#222', borderRadius: 2, overflow: 'hidden', margin: '6px 0' }}>
      <div style={{
        height: '100%', borderRadius: 2,
        background: ACCENT,
        width: `${Math.max(2, percent)}%`,
        transition: 'width 0.3s ease',
      }} />
    </div>
  )
}

function InMeetingBadge({ version, critical, ready }: { version: string; critical: boolean; ready?: boolean }) {
  return (
    <div style={{ ...chip, borderColor: critical ? RED : '#2a2a2a' }}>
      <style>{ANIM}</style>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: critical ? RED : ACCENT, flexShrink: 0 }} />
      <span style={{ color: '#aaa', fontSize: 11 }}>
        {ready
          ? `BeeHive ${version} downloaded — will install after your meeting`
          : `BeeHive ${version} available — will prompt after your meeting`}
      </span>
    </div>
  )
}

function Btn({ label, primary, onClick }: { label: string; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={primary ? primaryBtn : secondaryBtn}>
      {label}
    </button>
  )
}

// ---- Styles ----------------------------------------------------------------

const ANIM = `
@keyframes bhv-update-slide-in {
  from { opacity: 0; transform: translateY(12px) }
  to   { opacity: 1; transform: translateY(0) }
}
@keyframes bhv-update-chip-in {
  from { opacity: 0; transform: translateX(12px) }
  to   { opacity: 1; transform: translateX(0) }
}`

const card: React.CSSProperties = {
  position: 'fixed',
  bottom: 24,
  right: 24,
  width: 320,
  background: '#111',
  border: '1px solid #1e1e1e',
  borderRadius: 12,
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
  zIndex: 10000,
  fontFamily: "'Roboto', sans-serif",
  animation: 'bhv-update-slide-in 0.25s cubic-bezier(0.4,0,0.2,1)',
}

const chip: React.CSSProperties = {
  position: 'fixed',
  bottom: 80,
  right: 24,
  background: '#111',
  border: '1px solid #2a2a2a',
  borderRadius: 20,
  padding: '7px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
  zIndex: 10000,
  fontFamily: "'Roboto', sans-serif",
  animation: 'bhv-update-chip-in 0.2s ease',
  maxWidth: 340,
}

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const title: React.CSSProperties = {
  color: '#eee',
  fontSize: 13,
  fontWeight: 500,
}

const subtext: React.CSSProperties = {
  color: '#666',
  fontSize: 11,
  margin: 0,
}

const notesList: React.CSSProperties = {
  margin: 0,
  padding: '0 0 0 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

const noteItem: React.CSSProperties = {
  color: '#aaa',
  fontSize: 12,
  lineHeight: 1.5,
}

const btnRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 2,
}

const baseBtn: React.CSSProperties = {
  border: 'none',
  borderRadius: 7,
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: "'Roboto', sans-serif",
  transition: 'opacity 0.15s',
}

const primaryBtn: React.CSSProperties = {
  ...baseBtn,
  background: ACCENT,
  color: '#111',
}

const secondaryBtn: React.CSSProperties = {
  ...baseBtn,
  background: '#1e1e1e',
  color: '#aaa',
  border: '1px solid #2a2a2a',
}

function dot(color: string): React.CSSProperties {
  return { width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}
