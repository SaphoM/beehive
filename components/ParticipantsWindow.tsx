import { useState } from 'react'
import { X, Mic, MicOff, Video, VideoOff, MessageSquare, Crown } from 'lucide-react'
import { ParticipantTile, useTracks, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'

// Same API_BASE resolution used elsewhere for backend calls from the client.
const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

interface SupabaseParticipant { display_name: string | null; role: string | null; is_active: boolean | null }

// Was two components: a floating, draggable grid window (ParticipantsWindow)
// that could be dragged onto the header to become this strip, plus this
// strip itself. Collapsed into one — the strip IS the attendees view now,
// always: a horizontal, always-scrollable bar docked under the header, in
// every view (desktop, mobile, fullscreen), opened only by an explicit
// click, no drag gesture required to reach this layout.
export function DockedParticipantsStrip({ onClose, onDirectChat, roomId, isHost, hostSecret, supabaseParticipants }: {
  onClose: () => void
  onDirectChat?: (name: string) => void
  // Co-host toggle — only meaningful in a waiting-room-gated (scheduled)
  // meeting, and only the room's actual creator (isHost, backed by a
  // locally-held hostSecret) can use it, per the backend's "delegation
  // itself is host-only" rule. Undefined/false on Start Now meetings.
  roomId?: string
  isHost?: boolean
  hostSecret?: string | null
  supabaseParticipants?: SupabaseParticipant[]
}) {
  const lkParticipants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const [busyName, setBusyName] = useState<string | null>(null)

  // room_participants has no identity column — matched by display_name,
  // same limitation this whole feature already lives with server-side.
  const roleFor = (name: string) =>
    supabaseParticipants?.find(p => p.is_active && p.display_name === name)?.role ?? 'participant'

  const toggleCoHost = async (name: string) => {
    if (!roomId || !hostSecret) return
    setBusyName(name)
    try {
      await fetch(`${API_BASE}/api/rooms/${roomId}/grant-co-host`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, grant: roleFor(name) !== 'co-host', hostSecret }),
      })
    } catch (e) {
      console.error('[participants] grant-co-host failed:', e)
    } finally {
      setBusyName(null)
    }
  }

  return (
    <div style={s.dockedStrip}>
      <div style={s.dockedInner}>
        {lkParticipants.map(participant => {
          const camTrack = cameraTracks.find(t => t.participant.identity === participant.identity)
          const isMuted = !participant.isMicrophoneEnabled
          const isCamOff = !participant.isCameraEnabled
          const name = participant.name || participant.identity
          const role = roleFor(name)
          const isCoHost = role === 'co-host'
          return (
            <div key={participant.identity} style={s.dockedTile}>
              {camTrack && !isCamOff ? (
                <ParticipantTile trackRef={camTrack} style={{ width: '100%', height: '100%', borderRadius: 6 }} />
              ) : (
                <div style={s.dockedNoVideo}><VideoOff size={14} color="#555" /></div>
              )}
              <div style={s.dockedTileBar}>
                <span style={s.dockedName}>{name.split(' ')[0]}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {isMuted ? <MicOff size={9} color="#e53e3e" /> : <Mic size={9} color="#48bb78" />}
                  {isCamOff && <VideoOff size={9} color="#e53e3e" />}
                  {onDirectChat && (
                    <button
                      onClick={() => onDirectChat(name)}
                      title={`Message ${name}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', display: 'flex', alignItems: 'center', padding: 0 }}
                    >
                      <MessageSquare size={10} />
                    </button>
                  )}
                  {/* Delegated admit rights — host-only, and never shown on
                      the host's own tile (roleFor() is 'host' there). */}
                  {isHost && roomId && hostSecret && role !== 'host' && (
                    <button
                      onClick={() => toggleCoHost(name)}
                      disabled={busyName === name}
                      title={isCoHost ? 'Remove co-host' : 'Make co-host'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: isCoHost ? '#f5a623' : '#999', display: 'flex', alignItems: 'center', padding: 0 }}
                    >
                      <Crown size={10} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={s.dockedActions}>
        <button style={s.dockedBtn} onClick={onClose} title="Close"><X size={12} /></button>
      </div>
    </div>
  )
}
