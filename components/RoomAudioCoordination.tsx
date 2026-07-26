// ============================================================
// SAME-ROOM AUDIO COORDINATION (opt-in, per-meeting)
// ============================================================
// Mission recap: when BeeHive suspects multiple attendees share a physical
// room, offer (never force) coordinating their mics — the active speaker's
// mic stays fully open, everyone else opted in gets gently ducked (not
// muted) while they aren't speaking, restoring instantly when they are.
//
// Safety properties, by construction:
//   - A participant's own client only ever adjusts ITS OWN outgoing gain —
//     nobody's mic is touched by anyone else's client. There is no new
//     server-side muting path here at all.
//   - Manual mute is untouched: ducking only ever runs on an actively
//     published mic track: if the user has muted, there's no track to
//     process, so this is a natural no-op — nothing to "respect" via a
//     special case.
//   - Moderator/host force-mute (see livekit_node_backend.js's /mute
//     endpoint from the moderation feature) happens at the LiveKit SFU
//     level, entirely independent of this local gain graph — it wins
//     regardless of what this component is doing.
//   - Detection (useSameRoomDetection.ts) only ever produces a dismissible
//     suggestion. Enabling coordination is always an explicit user action.
import { useEffect, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import type { LocalParticipant, Participant } from 'livekit-client'
import { useTracks } from '@livekit/components-react'
import { supabase } from '../livekit_react_hooks'
import { RoomCoordinationProcessor, isRoomCoordinationSupported } from './RoomCoordinationProcessor'
import { useSameRoomDetection } from './useSameRoomDetection'

// How often the ducking decision is re-evaluated. Short enough to feel
// instantaneous (mission: "nearly instantaneous", "no noticeable delays")
// — the actual gain change is a smooth 80ms ramp (RoomCoordinationProcessor),
// this interval just decides *when* to start that ramp.
const DUCK_DECISION_INTERVAL_MS = 120

export function RoomAudioCoordination({
  roomId,
  localParticipant,
  participants,
  rawMicTrack,
}: {
  roomId: string
  localParticipant: LocalParticipant
  participants: Participant[]
  rawMicTrack: MediaStreamTrack | null
}) {
  const [enabled, setEnabled] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [optedIn, setOptedIn] = useState<Set<string>>(new Set())
  const channelRef = useRef<any>(null)
  const processorRef = useRef<RoomCoordinationProcessor | null>(null)
  // isRoomCoordinationSupported() is async (it dynamically imports Krisp's
  // support check rather than force-loading Krisp's WASM payload just to
  // answer this) — resolved once on mount, defaulting to unsupported until
  // it settles rather than assuming support prematurely.
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    let cancelled = false
    isRoomCoordinationSupported().then(v => { if (!cancelled) setSupported(v) })
    return () => { cancelled = true }
  }, [])

  // Who else has coordination on this meeting — a plain broadcast, the same
  // pattern already used for hands/moderation elsewhere in this app. Only
  // ever used to decide whose `isSpeaking` counts toward *my own* ducking
  // decision below — never used to act on anyone else's track.
  useEffect(() => {
    if (!supported) return
    const channel = supabase.channel(`room-coordination:${roomId}`, { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'opted_in' }, ({ payload }: any) => {
        setOptedIn(prev => new Set(prev).add(payload.identity))
      })
      .on('broadcast', { event: 'opted_out' }, ({ payload }: any) => {
        setOptedIn(prev => { const next = new Set(prev); next.delete(payload.identity); return next })
      })
      .subscribe()
    channelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [roomId, supported])

  // Remote mic tracks for the same-room heuristic — subscribed audio only,
  // since an unsubscribed placeholder has no real MediaStreamTrack to analyze.
  const micTracks = useTracks([{ source: Track.Source.Microphone, withPlaceholder: false }], { onlySubscribed: true })
  const remoteTracksForDetection = micTracks
    .filter(t => t.participant.identity !== localParticipant.identity && t.publication?.track?.mediaStreamTrack)
    .map(t => ({ identity: t.participant.identity, track: t.publication!.track!.mediaStreamTrack! }))

  const detectionActive = supported && !enabled && !dismissed && rawMicTrack != null
  const suspected = useSameRoomDetection(detectionActive ? rawMicTrack : null, remoteTracksForDetection, detectionActive)
  const showPrompt = detectionActive && suspected.size > 0

  function handleEnable() {
    setEnabled(true)
    setOptedIn(prev => new Set(prev).add(localParticipant.identity))
    channelRef.current?.send({ type: 'broadcast', event: 'opted_in', payload: { identity: localParticipant.identity } })
  }
  function handleDismiss() {
    setDismissed(true)
  }
  function handleDisable() {
    setEnabled(false)
    channelRef.current?.send({ type: 'broadcast', event: 'opted_out', payload: { identity: localParticipant.identity } })
  }

  // Swap the mic's processor between plain Krisp (default, everyone) and
  // the composite Krisp+duck processor (only while this participant has
  // coordination enabled). Reapplies whenever the mic track itself changes
  // (toggled off/on creates a new track) — same trigger the app's existing
  // plain-Krisp effect already reacts to.
  useEffect(() => {
    if (!supported) return
    const pub = localParticipant.getTrackPublication(Track.Source.Microphone)
    const track = pub?.track
    if (!track) return
    let cancelled = false
    ;(async () => {
      if (enabled) {
        try {
          const proc = new RoomCoordinationProcessor()
          await track.setProcessor(proc as any)
          if (cancelled) { await proc.destroy(); return }
          processorRef.current = proc
        } catch { /* best-effort — never block the mic on a processor failure */ }
      } else if (processorRef.current) {
        try {
          const { KrispNoiseFilter } = await import('@livekit/krisp-noise-filter')
          if (!cancelled) await track.setProcessor(KrispNoiseFilter())
        } catch { /* best-effort */ }
        processorRef.current = null
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, localParticipant, rawMicTrack])

  // The actual ducking decision: am I quiet while someone else who's also
  // opted in is currently speaking? If so, duck; otherwise stay at normal
  // gain. Never touches anyone else's track — only ever reads their
  // `isSpeaking` (data LiveKit already exposes for every participant) to
  // decide what to do with this participant's own gain node.
  useEffect(() => {
    if (!enabled) return
    const tick = setInterval(() => {
      const proc = processorRef.current
      if (!proc) return
      const anotherOptedInIsSpeaking = participants.some(
        p => p.identity !== localParticipant.identity && optedIn.has(p.identity) && p.isSpeaking,
      )
      proc.setDucked(anotherOptedInIsSpeaking && !localParticipant.isSpeaking)
    }, DUCK_DECISION_INTERVAL_MS)
    return () => clearInterval(tick)
  }, [enabled, participants, optedIn, localParticipant])

  if (!showPrompt && !enabled) return null

  return (
    <div
      style={{
        position: 'absolute', bottom: 90, left: '50%', transform: 'translateX(-50%)', zIndex: 16,
        background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)', border: '1px solid #333',
        borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        maxWidth: 380, fontFamily: "'Roboto', sans-serif", boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      }}
    >
      {enabled ? (
        <>
          <span style={{ color: '#68d391', fontSize: 12 }}>🔊 Room Audio Coordination is on</span>
          <button
            onClick={handleDisable}
            style={{ background: 'none', border: '1px solid #444', borderRadius: 6, color: '#999', fontSize: 11, padding: '3px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Turn off
          </button>
        </>
      ) : (
        <>
          <span style={{ color: '#ddd', fontSize: 12, lineHeight: 1.4 }}>
            It looks like multiple BeeHive participants may be in the same room. Enable Room Audio Coordination?
          </span>
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button
              onClick={handleEnable}
              style={{ background: '#f5a623', border: 'none', borderRadius: 6, color: '#000', fontSize: 11, fontWeight: 600, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Enable
            </button>
            <button
              onClick={handleDismiss}
              style={{ background: 'none', border: '1px solid #444', borderRadius: 6, color: '#999', fontSize: 11, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  )
}
