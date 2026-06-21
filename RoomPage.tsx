import { useState, useEffect, useRef, useCallback } from 'react'
import { PhoneOff, Link, Link2Off, Film, Hand, MessageSquare, Mic, MicOff, Video, VideoOff, X, Monitor, MonitorOff, MonitorX, ArrowLeftRight, CheckSquare, Square } from 'lucide-react'
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  TrackToggle,
  useParticipants as useLiveKitParticipants,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'
import {
  useCreateRoom,
  useJoinRoom,
  useParticipants,
  useChat,
  useRecordings,
  useRoomInfo,
} from './livekit_react_hooks'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥']
const QUALITY_OPTIONS = ['Low (360p)', 'Medium (720p)', 'High (1080p)']

// ============================================================
// MAIN PAGE
// ============================================================
const APP_NAME = 'BeeHive'
const SUBTEXTS = ['Meet', 'Sting'] as const
type Subtext = typeof SUBTEXTS[number]

export default function RoomPage() {
  const [view, setView] = useState<'lobby' | 'room'>('lobby')
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [activeRoomName, setActiveRoomName] = useState<string | null>(null)
  const [livekitRoomName, setLivekitRoomName] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState<string | null>(null)
  const [subtext, setSubtext] = useState<Subtext>('Meet')

  const { createRoom, loading: creating } = useCreateRoom()
  const { joinRoom, loading: joining } = useJoinRoom()
  const { room: inviteRoom } = useRoomInfo(joinRoomId)

  // Check URL for invite link (?room=ROOM_ID)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('room')
    if (roomId) setJoinRoomId(roomId)
  }, [])

  const handleCreate = async () => {
    if (!displayName.trim()) return alert('Enter your name first')
    const room = await createRoom(`Meeting ${new Date().toLocaleTimeString()}`, 'X Spark')
    if (!room) return alert('Failed to create room')
    const result = await joinRoom(room.id, displayName)
    if (!result) return alert('Failed to get access token')
    window.history.pushState({}, '', `?room=${room.id}`)
    setActiveRoomId(room.id)
    setActiveRoomName(room.name)
    setLivekitRoomName(result.livekitRoomName)
    setToken(result.token)
    setView('room')
  }

  const handleJoin = async () => {
    if (!displayName.trim()) return alert('Enter your name first')
    if (!joinRoomId) return
    const result = await joinRoom(joinRoomId, displayName)
    if (!result) return alert('Failed to join room — link may be invalid')
    setActiveRoomId(joinRoomId)
    setActiveRoomName(result.roomName)
    setLivekitRoomName(result.livekitRoomName)
    setToken(result.token)
    setView('room')
  }

  const handleLeave = () => {
    window.history.pushState({}, '', '/')
    setView('lobby')
    setActiveRoomId(null)
    setActiveRoomName(null)
    setLivekitRoomName(null)
    setToken(null)
  }

  if (view === 'room' && token && activeRoomId && livekitRoomName) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={true}
        onDisconnected={handleLeave}
        style={{ height: '100vh' }}
      >
        <MeetingRoom
          roomId={activeRoomId}
          roomName={activeRoomName ?? ''}
          displayName={displayName}
          onLeave={handleLeave}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    )
  }

  return (
    <Lobby
      displayName={displayName}
      onDisplayNameChange={setDisplayName}
      onCreateRoom={handleCreate}
      onJoinRoom={joinRoomId ? handleJoin : undefined}
      creating={creating || joining}
      hasInvite={!!joinRoomId}
      inviteRoom={inviteRoom}
      subtext={subtext}
      onSubtextChange={setSubtext}
    />
  )
}

// ============================================================
// LOBBY
// ============================================================
function Lobby({
  displayName, onDisplayNameChange, onCreateRoom, onJoinRoom, creating, hasInvite, inviteRoom, subtext, onSubtextChange,
}: {
  displayName: string
  onDisplayNameChange: (v: string) => void
  onCreateRoom: () => void
  onJoinRoom?: () => void
  creating: boolean
  hasInvite: boolean
  inviteRoom?: { name: string; participantCount: number } | null
  subtext: Subtext
  onSubtextChange: (v: Subtext) => void
}) {
  return (
    <div style={s.lobby}>
      <div style={s.lobbyCard}>
        <h1 style={s.title}>
          <span style={{ fontWeight: 400 }}>BEE</span>HIVE
        </h1>

        {hasInvite && inviteRoom ? (
          /* ── Invite Preview ── */
          <div style={s.invitePreview}>
            <p style={s.inviteLabel}>You've been invited to</p>
            <p style={s.inviteRoomName}>{inviteRoom.name}</p>
            <p style={s.inviteMeta}>
              {inviteRoom.participantCount > 0
                ? `${inviteRoom.participantCount} participant${inviteRoom.participantCount !== 1 ? 's' : ''} in the room`
                : 'Be the first to join'}
            </p>
          </div>
        ) : !hasInvite ? (
          <div style={s.subtextRow}>
            {SUBTEXTS.map(t => (
              <button
                key={t}
                style={{ ...s.subtextBtn, ...(subtext === t ? s.subtextActive : {}) }}
                onClick={() => onSubtextChange(t)}
              >
                {t}
              </button>
            ))}
          </div>
        ) : null}

        <input
          style={s.input}
          placeholder="Your name"
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (hasInvite ? onJoinRoom?.() : onCreateRoom())}
          autoFocus
        />

        {hasInvite ? (
          <>
            <button style={s.primaryBtn} onClick={onJoinRoom} disabled={creating}>
              {creating ? 'Joining…' : 'Join Meeting'}
            </button>
            <button style={s.secondaryBtn} onClick={onCreateRoom} disabled={creating}>
              Start a new meeting instead
            </button>
          </>
        ) : (
          <button style={s.primaryBtn} onClick={onCreateRoom} disabled={creating}>
            {creating ? 'Starting…' : `Start ${subtext}`}
          </button>
        )}
      </div>
    </div>
  )
}

// ============================================================
// MEETING ROOM
// ============================================================
function MeetingRoom({ roomId, roomName, displayName, onLeave }: {
  roomId: string; roomName: string; displayName: string; onLeave: () => void
}) {
  const allTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()
  // Exclude local screen share from the grid — prevents the infinite mirror echo
  const tracks = allTracks.filter(t =>
    !(t.participant.identity === localParticipant.identity && t.source === Track.Source.ScreenShare)
  )
  const participants = useParticipants(roomId)
  const { messages, sendMessage } = useChat(roomId)
  const recordings = useRecordings(roomId)
  const [chatInput, setChatInput] = useState('')
  const [showChat, setShowChat] = useState(true)
  const [showParticipants, setShowParticipants] = useState(false)
  const [participantsDocked, setParticipantsDocked] = useState(false)
  const [showQuality, setShowQuality] = useState(false)
  const [quality, setQuality] = useState('Medium (720p)')
  const [floatingReactions, setFloatingReactions] = useState<{ id: number; emoji: string }[]>([])
  const [copied, setCopied] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const reactionId = useRef(0)

  // Screen share state
  const [shareMenu, setShareMenu] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [clearBeforeShare, setClearBeforeShare] = useState(false)
  const [shareLabel, setShareLabel] = useState('')
  const [secondaryStream, setSecondaryStream] = useState<MediaStream | null>(null)
  const [activeSlot, setActiveSlot] = useState<'primary' | 'secondary'>('primary')
  const [roomHidden, setRoomHidden] = useState(false)
  const stopShareRef = useRef<() => void>()

  const stopShare = useCallback(async () => {
    try { await localParticipant.setScreenShareEnabled(false) } catch {}
    secondaryStream?.getTracks().forEach(t => t.stop())
    setSecondaryStream(null)
    setIsSharing(false)
    setShareLabel('')
    setActiveSlot('primary')
  }, [localParticipant, secondaryStream])

  useEffect(() => { stopShareRef.current = stopShare }, [stopShare])

  const startShare = useCallback(async () => {
    if (clearBeforeShare) {
      setRoomHidden(true)
      await new Promise(r => setTimeout(r, 400))
    }
    try {
      await localParticipant.setScreenShareEnabled(true)
      if (clearBeforeShare) setRoomHidden(false)
      const pub = localParticipant.getTrackPublication(Track.Source.ScreenShare)
      const label = (pub?.track as any)?.mediaStreamTrack?.label || 'Your screen'
      setShareLabel(label)
      setIsSharing(true)
      setShareMenu(false)
      ;(pub?.track as any)?.mediaStreamTrack?.addEventListener('ended', () => stopShareRef.current?.())
    } catch {
      if (clearBeforeShare) setRoomHidden(false)
    }
  }, [clearBeforeShare, localParticipant])

  const addWindow = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true })
      setSecondaryStream(stream)
    } catch { /* cancelled */ }
  }, [])

  const switchSource = useCallback(async () => {
    if (!secondaryStream) return
    const pub = localParticipant.getTrackPublication(Track.Source.ScreenShare)
    if (!pub?.track) return
    const [newTrack] = secondaryStream.getVideoTracks()
    try {
      await (pub.track as any).replaceTrack(newTrack)
      setShareLabel(newTrack.label || 'Window')
      setActiveSlot(s => s === 'primary' ? 'secondary' : 'primary')
    } catch { /* track replacement failed */ }
  }, [secondaryStream, localParticipant])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!chatInput.trim()) return
    await sendMessage(chatInput, displayName)
    setChatInput('')
  }

  const sendReaction = (emoji: string) => {
    const id = reactionId.current++
    setFloatingReactions(prev => [...prev, { id, emoji }])
    setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), 2500)
  }

  const copyInviteLink = () => {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const activeCount = participants.filter(p => p.is_active).length

  return (
    <div style={{ ...s.roomWrapper, opacity: roomHidden ? 0 : 1, transition: 'opacity 0.3s', pointerEvents: roomHidden ? 'none' : 'auto' }}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.roomTitle}>{APP_NAME}</span>
          <button style={s.pill} onClick={() => setShowParticipants(v => !v)}>
            {activeCount} {activeCount === 1 ? 'participant' : 'participants'}
          </button>
        </div>
        <div style={s.headerRight}>
          <button style={s.iconBtn} onClick={() => setShowChat(v => !v)} title="Toggle chat">
            <MessageSquare size={18} />
          </button>
          <button style={s.leaveBtn} onClick={onLeave}>Leave</button>
        </div>
      </div>

      {/* Docked participants strip — sits between header and room body */}
      {showParticipants && participantsDocked && (
        <DockedParticipantsStrip
          onUndock={() => setParticipantsDocked(false)}
          onClose={() => { setShowParticipants(false); setParticipantsDocked(false) }}
        />
      )}

      <div style={s.roomBody}>
        {/* Floating participants window */}
        {showParticipants && !participantsDocked && (
          <ParticipantsWindow
            onClose={() => setShowParticipants(false)}
            onDock={() => setParticipantsDocked(true)}
          />
        )}

        {/* Video Grid */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <GridLayout tracks={tracks} style={{ height: '100%' }}>
            <ParticipantTile />
          </GridLayout>

          {/* Active Share Bar */}
          {isSharing && (
            <ScreenShareBar
              label={shareLabel}
              hasSecondary={!!secondaryStream}
              activeSlot={activeSlot}
              onAddWindow={addWindow}
              onSwitch={switchSource}
              onStop={stopShare}
            />
          )}

          {/* Floating Reactions */}
          <div style={s.reactionFloat}>
            {floatingReactions.map(r => (
              <span key={r.id} style={s.floatingEmoji}>{r.emoji}</span>
            ))}
          </div>

          {/* Controls Bar */}
          <div style={s.controls}>
            {/* Mic */}
            <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} showIcon />

            {/* Cam */}
            <TrackToggle source={Track.Source.Camera} style={s.controlBtn} showIcon />

            {/* Reactions */}
            <div style={{ position: 'relative' }}>
              <button style={s.controlBtn} title="Reactions">
                <Hand size={20} />
              </button>
              <div style={s.reactionBar}>
                {REACTIONS.map(e => (
                  <button key={e} style={s.emojiBtn} onClick={() => sendReaction(e)}>{e}</button>
                ))}
              </div>
            </div>

            {/* Invite Link */}
            <button style={s.controlBtn} onClick={copyInviteLink} title="Copy invite link">
              {copied ? <Link2Off size={20} /> : <Link size={20} />}
            </button>

            {/* Video Quality */}
            <div style={{ position: 'relative' }}>
              <button style={s.controlBtn} onClick={() => setShowQuality(v => !v)} title="Video quality">
                <Film size={20} />
                <span style={s.hdBadge}>HD</span>
              </button>
              {showQuality && (
                <div style={s.qualityMenu}>
                  {QUALITY_OPTIONS.map(q => (
                    <button
                      key={q}
                      style={{ ...s.qualityOption, ...(quality === q ? s.qualityActive : {}) }}
                      onClick={() => { setQuality(q); setShowQuality(false) }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Screen Share */}
            <div style={{ position: 'relative' }}>
              <button
                style={{ ...s.controlBtn, ...(isSharing ? { background: '#276127', border: '1px solid #48bb78' } : {}) }}
                onClick={() => isSharing ? stopShare() : setShareMenu(v => !v)}
                title={isSharing ? 'Stop sharing' : 'Share screen'}
              >
                {isSharing ? <MonitorOff size={20} /> : <Monitor size={20} />}
              </button>
              {shareMenu && !isSharing && (
                <ScreenShareMenu
                  clearBeforeShare={clearBeforeShare}
                  onToggleClear={() => setClearBeforeShare(v => !v)}
                  onShare={startShare}
                  onClose={() => setShareMenu(false)}
                />
              )}
            </div>

            {/* Leave */}
            <button style={{ ...s.controlBtn, background: '#c53030' }} onClick={onLeave} title="Leave">
              <PhoneOff size={20} />
            </button>
          </div>
        </div>

        {/* Chat Sidebar */}
        {showChat && (
          <div style={s.sidebar}>
            <div style={s.sidebarTitle}>Chat</div>
            <div style={s.messages}>
              {messages.length === 0 && (
                <p style={{ color: '#555', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
                  No messages yet
                </p>
              )}
              {messages.map(m => (
                <div key={m.id} style={s.message}>
                  <span style={s.msgName}>{m.display_name}</span>
                  <span style={s.msgText}>{m.message}</span>
                  <span style={s.msgTime}>
                    {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div style={s.chatInputRow}>
              <input
                style={{ ...s.input, flex: 1, margin: 0 }}
                placeholder="Message…"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              />
              <button style={s.sendBtn} onClick={handleSend}>↑</button>
            </div>

            {recordings.length > 0 && (
              <div style={s.recordings}>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>RECORDINGS</div>
                {recordings.map(r => (
                  <a key={r.id} href={r.file_url} target="_blank" rel="noreferrer" style={s.recLink}>
                    🎥 {new Date(r.created_at).toLocaleDateString()} — {r.status}
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}


// ============================================================
// PARTICIPANTS WINDOW (draggable, dockable)
// ============================================================
function ParticipantsWindow({ onClose, onDock }: { onClose: () => void; onDock: () => void }) {
  const lkParticipants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
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

// ============================================================
// DOCKED PARTICIPANTS STRIP
// ============================================================
function DockedParticipantsStrip({ onUndock, onClose }: { onUndock: () => void; onClose: () => void }) {
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

// ============================================================
// SCREEN SHARE MENU
// ============================================================
function ScreenShareMenu({ clearBeforeShare, onToggleClear, onShare, onClose }: {
  clearBeforeShare: boolean
  onToggleClear: () => void
  onShare: () => void
  onClose: () => void
}) {
  return (
    <div style={s.shareMenu}>
      <div style={s.shareMenuHeader}>
        <span style={s.shareMenuTitle}>Share Screen</span>
        <button style={s.shareMenuClose} onClick={onClose}><X size={14} /></button>
      </div>

      <button style={s.shareMenuRow} onClick={onToggleClear}>
        {clearBeforeShare
          ? <CheckSquare size={14} color="#f5a623" />
          : <Square size={14} color="#555" />}
        <span style={{ ...s.shareMenuText, color: clearBeforeShare ? '#f5a623' : '#888' }}>
          Clear screen before sharing
        </span>
      </button>

      <div style={s.shareMenuDivider} />

      <button style={s.shareMenuOption} onClick={onShare}>
        <Monitor size={15} color="#aaa" />
        <span>Entire Screen</span>
      </button>

      <button style={s.shareMenuOption} onClick={onShare}>
        <ArrowLeftRight size={15} color="#aaa" />
        <span>Select Window</span>
      </button>
    </div>
  )
}

// ============================================================
// SCREEN SHARE ACTIVE BAR
// ============================================================
function ScreenShareBar({ label, hasSecondary, activeSlot, onAddWindow, onSwitch, onStop }: {
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

// ============================================================
// STYLES
// ============================================================
const s: Record<string, React.CSSProperties> = {
  lobby: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a' },
  lobbyCard: { background: '#161616', borderRadius: 20, padding: '40px 44px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 360, boxShadow: '0 0 40px rgba(0,0,0,0.6)', fontFamily: "'Roboto', sans-serif" },
  title: { color: '#fff', margin: 0, fontSize: 32, fontWeight: 100, letterSpacing: 4, textTransform: 'uppercase', fontFamily: "'Roboto', sans-serif" },
  subtitle: { color: '#555', margin: 0, fontSize: 11, fontWeight: 300, letterSpacing: 2, textTransform: 'uppercase', fontFamily: "'Roboto', sans-serif" },
  input: { background: '#222', border: '1px solid #333', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  primaryBtn: { background: '#5b5ef4', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' },
  secondaryBtn: { background: '#222', color: '#aaa', border: '1px solid #333', borderRadius: 10, padding: '11px 20px', fontSize: 14, cursor: 'pointer', width: '100%' },
  invitePreview: { background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 10, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 4 },
  inviteLabel: { color: '#666', fontSize: 11, fontWeight: 300, letterSpacing: 1, textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif" },
  inviteRoomName: { color: '#fff', fontSize: 16, fontWeight: 300, letterSpacing: 2, fontFamily: "'Roboto', sans-serif" },
  inviteMeta: { color: '#f5a623', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif" },
  subtextRow: { display: 'flex', gap: 8 },
  subtextBtn: { background: '#222', color: '#666', border: '1px solid #2a2a2a', borderRadius: 20, padding: '5px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  subtextActive: { background: '#2a2a2a', color: '#f5a623', border: '1px solid #f5a623' },
  roomWrapper: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: '#111', borderBottom: '1px solid #222', zIndex: 10 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  roomTitle: { color: '#fff', fontWeight: 300, fontSize: 16, letterSpacing: 3, textTransform: 'uppercase', fontFamily: "'Roboto', sans-serif" },
  pill: { background: '#222', color: '#888', borderRadius: 20, padding: '3px 10px', fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: "'Roboto', sans-serif" },
  pwWindow: { background: '#161616', border: '1px solid #2a2a2a', borderRadius: 16, width: 480, maxHeight: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  pwHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #222' },
  pwTitle: { color: '#fff', fontSize: 11, fontWeight: 300, letterSpacing: 2, fontFamily: "'Roboto', sans-serif" },
  pwCount: { color: '#f5a623', marginLeft: 6 },
  pwClose: { background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', alignItems: 'center' },
  pwGrid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, padding: 16, overflowY: 'auto' as const },
  pwCard: { borderRadius: 10, overflow: 'hidden', background: '#1a1a1a', border: '1px solid #2a2a2a' },
  pwVideo: { position: 'relative' as const, aspectRatio: '16/9', background: '#111' },
  pwNoVideo: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' },
  pwStatusBar: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: 'linear-gradient(transparent, rgba(0,0,0,0.8))' },
  pwName: { color: '#fff', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  pwIcons: { display: 'flex', gap: 4, alignItems: 'center' },
  dockZone: { background: 'rgba(245,166,35,0.15)', border: '1px dashed #f5a623', borderRadius: 8, color: '#f5a623', fontSize: 11, fontWeight: 300, letterSpacing: 1, textAlign: 'center' as const, padding: '6px 0', marginBottom: 6, fontFamily: "'Roboto', sans-serif" },
  dockHint: { color: '#444', fontSize: 10, fontWeight: 300, letterSpacing: 0.5, fontFamily: "'Roboto', sans-serif" },
  dockedStrip: { display: 'flex', alignItems: 'center', background: '#111', borderBottom: '1px solid #1e1e1e', padding: '6px 12px', gap: 8, overflowX: 'auto' as const },
  dockedInner: { display: 'flex', gap: 8, flex: 1, overflowX: 'auto' as const },
  dockedTile: { position: 'relative' as const, width: 110, height: 70, borderRadius: 6, overflow: 'hidden', background: '#1a1a1a', border: '1px solid #2a2a2a', flexShrink: 0 },
  dockedNoVideo: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' },
  dockedTileBar: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 6px', background: 'linear-gradient(transparent, rgba(0,0,0,0.85))' },
  dockedName: { color: '#fff', fontSize: 10, fontWeight: 300, fontFamily: "'Roboto', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  dockedActions: { display: 'flex', gap: 4, flexShrink: 0 },
  dockedBtn: { background: '#222', border: '1px solid #333', borderRadius: 6, color: '#888', width: 26, height: 26, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 },
  iconBtn: { background: 'transparent', border: 'none', color: '#aaa', fontSize: 18, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, display: 'flex', alignItems: 'center' },
  leaveBtn: { background: '#c53030', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  roomBody: { display: 'flex', flex: 1, overflow: 'hidden' },
  reactionFloat: { position: 'absolute', bottom: 100, right: 20, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none', zIndex: 20 },
  floatingEmoji: { fontSize: 36, animation: 'floatUp 2.5s ease-out forwards' },
  controls: { position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)', borderRadius: 40, padding: '10px 20px', zIndex: 10 },
  controlBtn: { background: '#2a2a2a', border: 'none', borderRadius: 50, width: 48, height: 48, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', position: 'relative', gap: 2 },
  hdBadge: { position: 'absolute', bottom: 6, right: 6, fontSize: 8, fontWeight: 700, color: '#f5a623', lineHeight: 1 },
  reactionBar: { position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6, background: '#1a1a1a', border: '1px solid #333', borderRadius: 30, padding: '8px 12px' },
  emojiBtn: { background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', padding: '2px 4px', borderRadius: 6 },
  qualityMenu: { position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, overflow: 'hidden', minWidth: 160 },
  qualityOption: { display: 'block', width: '100%', background: 'none', border: 'none', color: '#ccc', padding: '10px 16px', cursor: 'pointer', fontSize: 13, textAlign: 'left' },
  qualityActive: { background: '#2a2a2a', color: '#fff', fontWeight: 600 },
  sidebar: { width: 300, background: '#111', borderLeft: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column' },
  sidebarTitle: { color: '#888', fontWeight: 600, fontSize: 11, letterSpacing: 1, padding: '14px 16px', borderBottom: '1px solid #1e1e1e', textTransform: 'uppercase' },
  messages: { flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  message: { display: 'flex', flexDirection: 'column', gap: 2 },
  msgName: { color: '#5b5ef4', fontSize: 12, fontWeight: 600 },
  msgText: { color: '#ddd', fontSize: 13, lineHeight: 1.4 },
  msgTime: { color: '#444', fontSize: 11 },
  chatInputRow: { display: 'flex', gap: 8, padding: '10px 12px', borderTop: '1px solid #1e1e1e' },
  sendBtn: { background: '#5b5ef4', color: '#fff', border: 'none', borderRadius: 8, width: 38, fontSize: 16, cursor: 'pointer' },
  recordings: { padding: '12px 14px', borderTop: '1px solid #1e1e1e' },
  recLink: { display: 'block', color: '#5b5ef4', fontSize: 13, textDecoration: 'none', marginBottom: 4 },

  // Screen share menu (popup above Monitor button)
  shareMenu: { position: 'absolute' as const, bottom: 62, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '10px', minWidth: 220, display: 'flex', flexDirection: 'column' as const, gap: 4, zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.7)' },
  shareMenuHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px', borderBottom: '1px solid #2a2a2a', marginBottom: 2 },
  shareMenuTitle: { color: '#888', fontSize: 10, fontWeight: 300, letterSpacing: 1.5, textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif" },
  shareMenuClose: { background: 'none', border: 'none', color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2 },
  shareMenuRow: { display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', padding: '7px 8px', borderRadius: 8, width: '100%', textAlign: 'left' as const },
  shareMenuText: { fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300 },
  shareMenuDivider: { height: 1, background: '#242424', margin: '4px 0' },
  shareMenuOption: { display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', padding: '10px 10px', borderRadius: 8, fontSize: 13, fontFamily: "'Roboto', sans-serif", fontWeight: 300, width: '100%', textAlign: 'left' as const },

  // Screen share active bar (floats above controls)
  shareBar: { position: 'absolute' as const, bottom: 88, left: '50%', transform: 'translateX(-50%)', background: 'rgba(10,20,10,0.9)', backdropFilter: 'blur(12px)', border: '1px solid #276127', borderRadius: 30, padding: '7px 16px', display: 'flex', alignItems: 'center', gap: 16, zIndex: 15, whiteSpace: 'nowrap' as const },
  shareBarLabel: { color: '#48bb78', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", display: 'flex', alignItems: 'center', gap: 6 },
  shareBarSlot: { background: '#1a3a1a', color: '#48bb78', fontSize: 10, fontWeight: 500, letterSpacing: 1, padding: '2px 7px', borderRadius: 10 },
  shareBarActions: { display: 'flex', gap: 6 },
  shareBarBtn: { background: '#1e1e1e', border: '1px solid #333', borderRadius: 20, padding: '4px 12px', color: '#ccc', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'Roboto', sans-serif", fontWeight: 300 },
}
