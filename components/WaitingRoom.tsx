import { useEffect, useState } from 'react'
import { supabase } from '../livekit_react_hooks'
import { s } from './roomStyles'
import { STING_RED, type Subtext } from './roomUtils'
import { BuiltByFooter } from './BuiltByFooter'
import { useDeviceReadiness } from './useDeviceReadiness'
import { DeviceReadinessBanner } from './DeviceReadinessBanner'

// Shown while a scheduled meeting's admission gate holds an attendee back —
// subscribes to this specific request's row and reacts the instant the host
// (or a co-host) decides, without the attendee needing to do anything.
export function WaitingRoom({ requestId, roomName, subtext, onAdmitted, onDenied }: {
  requestId: string
  roomName?: string
  subtext: Subtext
  onAdmitted: () => void
  onDenied: (reason: string) => void
}) {
  const [status, setStatus] = useState<'pending' | 'denied'>('pending')
  const [reason, setReason] = useState<string | null>(null)
  const deviceReadiness = useDeviceReadiness()

  useEffect(() => {
    const channel = supabase
      .channel(`admission:${requestId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'admission_requests', filter: `id=eq.${requestId}` },
        (payload) => {
          const next = payload.new as { status: string }
          if (next.status === 'admitted') onAdmitted()
          else if (next.status === 'denied') { setStatus('denied'); setReason('The host did not admit you to this meeting.') }
        }
      )
      .subscribe()

    // Cover the case where the decision landed between the token request
    // that produced this requestId and this subscription actually going
    // live — a plain one-time read closes that gap.
    supabase
      .from('admission_requests')
      .select('status')
      .eq('id', requestId)
      .single()
      .then(({ data }) => {
        if (data?.status === 'admitted') onAdmitted()
        else if (data?.status === 'denied') { setStatus('denied'); setReason('The host did not admit you to this meeting.') }
      })

    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId])

  return (
    <div style={{ ...s.lobby, flexDirection: 'column', gap: 16 }}>
      <div style={s.lobbyCard}>
        <h1 style={{ ...s.title, ...(subtext === 'Sting' ? { color: STING_RED } : {}) }}>
          <span style={{ fontWeight: 400 }}>BEE</span>HIVE
        </h1>
        {status === 'pending' ? (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '10px 0' }}>
              <div style={waitingSpinner} />
              <p style={{ color: '#ccc', fontSize: 14, fontFamily: "'Roboto', sans-serif", textAlign: 'center', margin: 0 }}>
                Waiting for the host to let you in{roomName ? <> to <strong>{roomName}</strong></> : null}…
              </p>
              <p style={{ color: '#555', fontSize: 12, fontFamily: "'Roboto', sans-serif", textAlign: 'center', margin: 0 }}>
                You'll join automatically as soon as you're admitted.
              </p>
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ color: '#e57373', fontSize: 14, fontFamily: "'Roboto', sans-serif", textAlign: 'center', margin: 0 }}>
              {reason}
            </p>
            <button
              type="button"
              style={s.secondaryBtn}
              onClick={() => onDenied(reason || 'Not admitted')}
            >
              Back to lobby
            </button>
          </div>
        )}
      </div>
      {/* Device readiness check — shown while the user has time to act */}
      <div style={{ width: '100%', maxWidth: 400 }}>
        <DeviceReadinessBanner readiness={deviceReadiness} />
      </div>
      <BuiltByFooter />
    </div>
  )
}

const waitingSpinner: React.CSSProperties = {
  width: 28, height: 28, borderRadius: '50%',
  border: '3px solid #333', borderTopColor: '#f5a623',
  animation: 'bhv-waiting-spin 0.9s linear infinite',
}

// Keyframes injected once via a plain <style> tag — same pattern already
// used elsewhere in this app (RoomPage.tsx/Toast.tsx) for small one-off
// animations that don't warrant a global stylesheet entry.
if (typeof document !== 'undefined' && !document.getElementById('bhv-waiting-spin-style')) {
  const style = document.createElement('style')
  style.id = 'bhv-waiting-spin-style'
  style.textContent = '@keyframes bhv-waiting-spin { to { transform: rotate(360deg) } }'
  document.head.appendChild(style)
}
