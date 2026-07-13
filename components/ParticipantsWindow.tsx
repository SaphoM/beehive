import { useState, useEffect, useRef } from 'react'
import { X, Mic, MicOff, Video, VideoOff, MessageSquare, Crown } from 'lucide-react'
import { ParticipantTile, useTracks, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'

// Same API_BASE resolution used elsewhere for backend calls from the client.
const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

interface SupabaseParticipant { display_name: string | null; role: string | null; is_active: boolean | null }

export function ParticipantsWindow({ onClose, onDock, onDirectChat, roomId, isHost, hostSecret, supabaseParticipants }: {
  onClose: () => void
  onDock: () => void
  onDirectChat?: (name: string) => void
  // The co-host toggle below is entirely optional — only meaningful in a
  // waiting-room-gated (scheduled) meeting, and only the room's actual
  // creator (isHost, backed by a locally-held hostSecret) can use it, per
  // the backend's "delegation itself is host-only" rule. Undefined/false on
  // Start Now meetings, where this component renders exactly as before.
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
        <div style={s.pwGrid}>
          {lkParticipants.map(participant => {
            const camTrack = cameraTracks.find(t => t.participant.identity === participant.identity)
            const isMuted = !participant.isMicrophoneEnabled
            const isCamOff = !participant.isCameraEnabled
            return (
              <div key={participant.identity} style={s.pwCard}>
                <div style={s.pwVideo}>
                  {camTrack && !isCamOff ? (
                    <ParticipantTile trackRef={camTrack} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
                  ) : (
                    <div style={s.pwNoVideo}><VideoOff size={22} color="#444" /></div>
                  )}
                  <div style={s.pwStatusBar}>
                    <span style={s.pwName}>{participant.name || participant.identity}</span>
                    <div style={s.pwIcons}>
                      {isMuted ? <MicOff size={12} color="#e53e3e" /> : <Mic size={12} color="#48bb78" />}
                      {isCamOff ? <VideoOff size={12} color="#e53e3e" /> : <Video size={12} color="#48bb78" />}
                      {onDirectChat && (
                        <button
                          onClick={() => onDirectChat(participant.name || participant.identity)}
                          title={`Message ${participant.name || participant.identity}`}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center', padding: 0, transition: 'color 0.12s' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#5b5ef4')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#555')}
                        >
                          <MessageSquare size={12} />
                        </button>
                      )}
                      {/* Delegated admit rights — host-only, and never shown on
                          the host's own tile (roleFor() is 'host' there, not
                          'participant'/'co-host'). */}
                      {isHost && roomId && hostSecret && (() => {
                        const name = participant.name || participant.identity
                        const role = roleFor(name)
                        if (role === 'host') return null
                        const isCoHost = role === 'co-host'
                        return (
                          <button
                            onClick={() => toggleCoHost(name)}
                            disabled={busyName === name}
                            title={isCoHost ? 'Remove co-host' : 'Make co-host'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isCoHost ? '#f5a623' : '#555', display: 'flex', alignItems: 'center', padding: 0 }}
                          >
                            <Crown size={12} />
                          </button>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function DockedParticipantsStrip({ onUndock, onClose }: { onUndock: () => void; onClose: () => void }) {
  const lkParticipants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })

  return (
    <div style={s.dockedStrip}>
      <div style={s.dockedInner}>
        {lkParticipants.map(participant => {
          const camTrack = cameraTracks.find(t => t.participant.identity === participant.identity)
          const isMuted = !participant.isMicrophoneEnabled
          const isCamOff = !participant.isCameraEnabled
          return (
            <div key={participant.identity} style={s.dockedTile}>
              {camTrack && !isCamOff ? (
                <ParticipantTile trackRef={camTrack} style={{ width: '100%', height: '100%', borderRadius: 6 }} />
              ) : (
                <div style={s.dockedNoVideo}><VideoOff size={14} color="#555" /></div>
              )}
              <div style={s.dockedTileBar}>
                <span style={s.dockedName}>{(participant.name || participant.identity).split(' ')[0]}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {isMuted ? <MicOff size={9} color="#e53e3e" /> : <Mic size={9} color="#48bb78" />}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={s.dockedActions}>
        <button style={s.dockedBtn} onClick={onUndock} title="Undock">↙</button>
        <button style={s.dockedBtn} onClick={onClose} title="Close"><X size={12} /></button>
      </div>
    </div>
  )
}
