import { useState, useEffect, useRef } from 'react'
import { X, UserCheck, UserX } from 'lucide-react'
import type { PendingAdmissionRequest } from '../livekit_react_hooks'
import { Avatar } from './Avatar'

// Floating panel (same convention as AutoCamWindow/MeetingPrepWindow) shown
// only to whoever holds role 'host'/'co-host' in a waiting-room-gated
// meeting — lists attendees currently held at the door, with Admit/Deny
// buttons calling the backend's /admit endpoint (never a direct client
// write — admission_requests has no client UPDATE policy at all, by
// design). `pending` is owned by RoomPage's useAdmissionRequests hook, not
// fetched here — that hook's subscription stays alive even while this panel
// is closed (so the toolbar badge/toast can work at all), so this component
// is now a plain consumer of that single shared list rather than running a
// second, duplicate Realtime subscription to the same table.
export function AdmissionRequestsWindow({ roomId, pending, hostSecret, actingDisplayName, onClose }: {
  roomId: string
  pending: PendingAdmissionRequest[]
  hostSecret: string | null
  actingDisplayName: string
  onClose: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // When the last pending request is resolved, start a 60s countdown then
  // auto-close. Cancel immediately if a new request arrives.
  useEffect(() => {
    if (pending.length > 0) {
      // Someone new (or still) waiting — cancel any pending auto-close
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
      if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null }
      setCountdown(null)
      return
    }
    // pending is now empty — start the countdown
    setCountdown(60)
    tickTimerRef.current = setInterval(() => {
      setCountdown(prev => (prev !== null && prev > 1 ? prev - 1 : prev))
    }, 1000)
    closeTimerRef.current = setTimeout(() => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
      setCountdown(null)
      onClose()
    }, 60000)
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      if (tickTimerRef.current) clearInterval(tickTimerRef.current)
    }
  }, [pending.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = async (requestId: string, decision: 'admit' | 'deny') => {
    setBusyId(requestId)
    try {
      await fetch(`${API_BASE}/api/rooms/${roomId}/admit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision, actingDisplayName, hostSecret: hostSecret ?? undefined }),
      })
      // No optimistic removal needed — the parent's useAdmissionRequests
      // subscription re-fetches on the resulting UPDATE and drops this row
      // from `pending` itself.
    } catch (e) {
      console.error('[admission] decision failed:', e)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={st.window}>
      <div style={st.header}>
        <span style={st.title}>WAITING ROOM {pending.length > 0 && <span style={st.badge}>{pending.length}</span>}</span>
        <button style={st.iconBtn} onClick={onClose} title="Close"><X size={14} /></button>
      </div>
      <div style={st.body}>
        {pending.length === 0 && (
          <p style={st.empty}>
            No one's waiting right now.
            {countdown !== null && (
              <span style={{ display: 'block', color: '#3a3a3a', fontSize: 10, marginTop: 4 }}>
                Closing in {countdown}s
              </span>
            )}
          </p>
        )}
        {pending.map((r) => (
          <div key={r.id} style={st.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              {/* Pending requests have no room_participants row yet (only
                  admission_requests), so there's no avatar_url to look up —
                  initials-only here, which the shared Avatar already
                  handles as its normal no-picture case. */}
              <Avatar name={r.display_name} size={22} />
              <span style={st.name}>{r.display_name}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ ...st.actionBtn, ...st.admitBtn }}
                disabled={busyId === r.id}
                onClick={() => decide(r.id, 'admit')}
                title="Admit"
              ><UserCheck size={14} /></button>
              <button
                style={{ ...st.actionBtn, ...st.denyBtn }}
                disabled={busyId === r.id}
                onClick={() => decide(r.id, 'deny')}
                title="Deny"
              ><UserX size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Same API_BASE resolution as livekit_react_hooks.tsx — duplicated locally
// rather than exported/shared, since it's a one-line environment check and
// this component has no other reason to import from that module.
const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

const st: Record<string, React.CSSProperties> = {
  window: {
    position: 'absolute', top: 20, right: 20, width: 260, maxHeight: '60%',
    background: '#141414', border: '1px solid #3a2c10', borderRadius: 12,
    overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.7)', zIndex: 15,
    display: 'flex', flexDirection: 'column', fontFamily: "'Roboto', sans-serif",
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', background: '#1a1a1a', borderBottom: '1px solid #222', flexShrink: 0,
  },
  title: { display: 'flex', alignItems: 'center', gap: 6, color: '#eee', fontSize: 11, fontWeight: 600, letterSpacing: 0.5 },
  badge: { background: '#f5a623', color: '#000', borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700 },
  iconBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2 },
  body: { padding: '8px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 },
  empty: { color: '#555', fontSize: 12, fontWeight: 300, textAlign: 'center', margin: '10px 0' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '7px 10px' },
  name: { color: '#ddd', fontSize: 12, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  actionBtn: { border: 'none', borderRadius: 6, width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 },
  admitBtn: { background: 'rgba(72,187,120,0.15)', color: '#48bb78' },
  denyBtn: { background: 'rgba(229,115,115,0.15)', color: '#e57373' },
}
