import { useState, useEffect, useRef } from 'react'
import { X, Mic, MicOff, VideoOff, MessageSquare, Crown, BellRing } from 'lucide-react'
import { ParticipantTile, useTracks, useLocalParticipant, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'
import { Avatar } from './Avatar'

// Same API_BASE resolution used elsewhere for backend calls from the client.
const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

interface SupabaseParticipant { display_name: string | null; role: string | null; is_active: boolean | null; avatar_url?: string | null }

interface CoHostProps {
  roomId?: string
  isHost?: boolean
  hostSecret?: string | null
  supabaseParticipants?: SupabaseParticipant[]
  onDirectChat?: (name: string) => void
  // Microphone moderation — distinct from `isHost` above (which gates only
  // co-host *delegation* and stays host-only by design). Mute/mute-all is
  // available to host AND co-host, matching the existing waiting-room admit
  // permission (RoomPage.tsx's `canAdmit`) — the same "moderator" concept
  // already established for this room, reused here rather than inventing a
  // second one.
  canModerate?: boolean
  actingDisplayName?: string
  onRequestUnmute?: (identity: string) => void
}

// Shared row of compact attendee tiles — always horizontal, always
// scrollable, never a grid. Used by both the floating (detached) window
// and the docked strip below, so dragging between the two never changes
// what the tiles look like, only the container around them.
function AttendeeTiles({ roomId, isHost, hostSecret, supabaseParticipants, onDirectChat, canModerate, actingDisplayName, onRequestUnmute }: CoHostProps) {
  const lkParticipants = useLiveKitParticipants()
  const { localParticipant } = useLocalParticipant()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const [busyName, setBusyName] = useState<string | null>(null)
  const [muteBusyIdentity, setMuteBusyIdentity] = useState<string | null>(null)

  // room_participants has no identity column — matched by display_name,
  // same limitation this whole feature already lives with server-side.
  const roleFor = (name: string) =>
    supabaseParticipants?.find(p => p.is_active && p.display_name === name)?.role ?? 'participant'
  const avatarUrlFor = (name: string) =>
    supabaseParticipants?.find(p => p.is_active && p.display_name === name)?.avatar_url ?? null

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

  // Force-mute is server-only — LiveKit's browser SDK has no ability to
  // affect a track it doesn't own, by design (see the backend endpoint's own
  // comment for why). This is a thin client for that endpoint; the endpoint
  // itself re-derives and enforces authorization independently, so this
  // being reachable at all client-side is not itself a security boundary.
  const muteOne = async (identity: string) => {
    if (!roomId || !canModerate) return
    setMuteBusyIdentity(identity)
    try {
      await fetch(`${API_BASE}/api/rooms/${roomId}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetIdentity: identity, hostSecret, actingDisplayName }),
      })
    } catch (e) {
      console.error('[participants] mute failed:', e)
    } finally {
      setMuteBusyIdentity(null)
    }
  }

  const muteAll = async () => {
    if (!roomId || !canModerate) return
    setMuteBusyIdentity('__all__')
    try {
      await fetch(`${API_BASE}/api/rooms/${roomId}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, excludeIdentity: localParticipant.identity, hostSecret, actingDisplayName }),
      })
    } catch (e) {
      console.error('[participants] mute-all failed:', e)
    } finally {
      setMuteBusyIdentity(null)
    }
  }

  const unmutedOthersCount = lkParticipants.filter(p => p.identity !== localParticipant.identity && p.isMicrophoneEnabled).length

  return (
    <div style={s.dockedInner}>
      {/* Mute all — host/co-host only, and only meaningful once someone
          other than the moderator actually has their mic on. */}
      {canModerate && roomId && unmutedOthersCount > 0 && (
        <button
          onClick={muteAll}
          disabled={muteBusyIdentity === '__all__'}
          title="Mute all attendees"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
            background: 'none', border: '1px dashed #444', borderRadius: 6, color: '#999', fontSize: 9,
            fontFamily: "'Roboto', sans-serif", cursor: 'pointer', flexShrink: 0, width: 56, height: 56,
          }}
        >
          <MicOff size={14} />
          Mute all
        </button>
      )}
      {lkParticipants.map(participant => {
        const camTrack = cameraTracks.find(t => t.participant.identity === participant.identity)
        const isMuted = !participant.isMicrophoneEnabled
        const isCamOff = !participant.isCameraEnabled
        const isSelf = participant.identity === localParticipant.identity
        const name = participant.name || participant.identity
        const role = roleFor(name)
        const isCoHost = role === 'co-host'
        return (
          <div key={participant.identity} style={s.dockedTile}>
            {camTrack && !isCamOff ? (
              <ParticipantTile trackRef={camTrack} style={{ width: '100%', height: '100%', borderRadius: 6 }} />
            ) : (
              <div style={s.dockedNoVideo}>
                <Avatar name={name} avatarUrl={avatarUrlFor(name)} size={34} />
              </div>
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
                {/* Mic moderation — host/co-host only, never on the
                    moderator's own tile (self-mute already exists via the
                    normal mic button and must stay the participant's own
                    action, never routed through this force-mute path). Mute
                    while on; "request unmute" while off, since there's no
                    server-side force-unmute to offer instead. */}
                {canModerate && !isSelf && roomId && (
                  isMuted ? (
                    onRequestUnmute && (
                      <button
                        onClick={() => onRequestUnmute(participant.identity)}
                        title={`Ask ${name} to unmute`}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', display: 'flex', alignItems: 'center', padding: 0 }}
                      >
                        <BellRing size={10} />
                      </button>
                    )
                  ) : (
                    <button
                      onClick={() => muteOne(participant.identity)}
                      disabled={muteBusyIdentity === participant.identity}
                      title={`Mute ${name}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', display: 'flex', alignItems: 'center', padding: 0 }}
                    >
                      <MicOff size={10} />
                    </button>
                  )
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
  )
}

// Draggable, detachable floating window — grab the ⠿ title bar to
// reposition; drag toward the top to dock it into the header as the
// horizontal strip below. The body is the same always-horizontal,
// always-scrollable row as the docked strip (never a grid) — dragging
// between docked and floating only changes the container, not the layout.
export function ParticipantsWindow({ onClose, onDock, onDirectChat, roomId, isHost, hostSecret, supabaseParticipants, canModerate, actingDisplayName, onRequestUnmute }: {
  onClose: () => void
  onDock: () => void
} & CoHostProps) {
  const lkParticipants = useLiveKitParticipants()
  const [pos, setPos] = useState({ x: 24, y: 24 })
  const [dragging, setDragging] = useState(false)
  const [nearDock, setNearDock] = useState(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, winX: 0, winY: 0 })

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, winX: pos.x, winY: pos.y }
  }

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: MouseEvent) => {
      const newX = dragStart.current.winX + e.clientX - dragStart.current.mouseX
      const newY = dragStart.current.winY + e.clientY - dragStart.current.mouseY
      setPos({ x: Math.max(0, newX), y: Math.max(0, newY) })
      setNearDock(newY < 60)
    }
    const onUp = () => {
      setDragging(false)
      if (nearDock) onDock()
      setNearDock(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging, nearDock, onDock])

  return (
    <div style={{ position: 'absolute', left: pos.x, top: pos.y, zIndex: 30, width: 480 }}>
      {nearDock && (
        <div style={s.dockZone}>
          ↑ Release to dock to header
        </div>
      )}
      <div style={{ ...s.pwWindow, boxShadow: dragging ? '0 32px 80px rgba(0,0,0,0.8)' : '0 20px 60px rgba(0,0,0,0.6)', transform: dragging ? 'scale(1.01)' : 'scale(1)', transition: dragging ? 'none' : 'transform 0.15s' }}>
        <div style={{ ...s.pwHeader, cursor: 'grab', userSelect: 'none' }} onMouseDown={handleDragStart}>
          <span style={s.pwTitle}>
            ⠿ &nbsp;PARTICIPANTS <span style={s.pwCount}>{lkParticipants.length}</span>
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={s.dockHint}>drag to header to dock</span>
            <button style={s.pwClose} onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <AttendeeTiles roomId={roomId} isHost={isHost} hostSecret={hostSecret} supabaseParticipants={supabaseParticipants} onDirectChat={onDirectChat} canModerate={canModerate} actingDisplayName={actingDisplayName} onRequestUnmute={onRequestUnmute} />
      </div>
    </div>
  )
}

export function DockedParticipantsStrip({ onUndock, onClose, onDirectChat, roomId, isHost, hostSecret, supabaseParticipants, canModerate, actingDisplayName, onRequestUnmute }: {
  onUndock: () => void
  onClose: () => void
} & CoHostProps) {
  return (
    <div style={s.dockedStrip}>
      <AttendeeTiles roomId={roomId} isHost={isHost} hostSecret={hostSecret} supabaseParticipants={supabaseParticipants} onDirectChat={onDirectChat} canModerate={canModerate} actingDisplayName={actingDisplayName} onRequestUnmute={onRequestUnmute} />
      <div style={s.dockedActions}>
        <button style={s.dockedBtn} onClick={onUndock} title="Undock">↙</button>
        <button style={s.dockedBtn} onClick={onClose} title="Close"><X size={12} /></button>
      </div>
    </div>
  )
}
