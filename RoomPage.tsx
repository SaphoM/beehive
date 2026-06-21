import { useState, useEffect, useRef, useCallback } from 'react'
import { PhoneOff, Link, Link2Off, Film, Hand, MessageSquare } from 'lucide-react'
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  TrackToggle,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import '@livekit/components-styles'
import {
  useCreateRoom,
  useJoinRoom,
  useParticipants,
  useChat,
  useRecordings,
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
    const tk = await joinRoom(room.id, displayName)
    if (!tk) return alert('Failed to get access token')
    window.history.pushState({}, '', `?room=${room.id}`)
    setActiveRoomId(room.id)
    setActiveRoomName(room.name)
    setLivekitRoomName(room.livekit_room_name)
    setToken(tk)
    setView('room')
  }

  const handleJoin = async () => {
    if (!displayName.trim()) return alert('Enter your name first')
    if (!joinRoomId) return
    const tk = await joinRoom(joinRoomId, displayName)
    if (!tk) return alert('Failed to join room — link may be invalid')
    setActiveRoomId(joinRoomId)
    setToken(tk)
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
      subtext={subtext}
      onSubtextChange={setSubtext}
    />
  )
}

// ============================================================
// LOBBY
// ============================================================
function Lobby({
  displayName, onDisplayNameChange, onCreateRoom, onJoinRoom, creating, hasInvite, subtext, onSubtextChange,
}: {
  displayName: string
  onDisplayNameChange: (v: string) => void
  onCreateRoom: () => void
  onJoinRoom?: () => void
  creating: boolean
  hasInvite: boolean
  subtext: Subtext
  onSubtextChange: (v: Subtext) => void
}) {
  return (
    <div style={s.lobby}>
      <div style={s.lobbyCard}>
        <div style={s.logo}>🐝</div>
        <h1 style={s.title}>{APP_NAME}</h1>
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
              {creating ? 'Joining…' : `Join ${APP_NAME} ${subtext}`}
            </button>
            <button style={s.secondaryBtn} onClick={onCreateRoom} disabled={creating}>
              Start New {subtext}
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
  const tracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false })
  const participants = useParticipants(roomId)
  const { messages, sendMessage } = useChat(roomId)
  const recordings = useRecordings(roomId)
  const [chatInput, setChatInput] = useState('')
  const [showChat, setShowChat] = useState(true)
  const [showQuality, setShowQuality] = useState(false)
  const [quality, setQuality] = useState('Medium (720p)')
  const [floatingReactions, setFloatingReactions] = useState<{ id: number; emoji: string }[]>([])
  const [copied, setCopied] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const reactionId = useRef(0)

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
    <div style={s.roomWrapper}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo2}>🐝</span>
          <span style={s.roomTitle}>{APP_NAME}</span>
          <span style={s.pill}>{activeCount} {activeCount === 1 ? 'participant' : 'participants'}</span>
        </div>
        <div style={s.headerRight}>
          <button style={s.iconBtn} onClick={() => setShowChat(v => !v)} title="Toggle chat">
            <MessageSquare size={18} />
          </button>
          <button style={s.leaveBtn} onClick={onLeave}>Leave</button>
        </div>
      </div>

      <div style={s.roomBody}>
        {/* Video Grid */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <GridLayout tracks={tracks} style={{ height: '100%' }}>
            <ParticipantTile />
          </GridLayout>

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
// STYLES
// ============================================================
const s: Record<string, React.CSSProperties> = {
  lobby: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0a0a' },
  lobbyCard: { background: '#161616', borderRadius: 20, padding: '40px 44px', display: 'flex', flexDirection: 'column', gap: 14, minWidth: 360, boxShadow: '0 0 40px rgba(0,0,0,0.6)' },
  logo: { fontSize: 36 },
  logo2: { fontSize: 20 },
  title: { color: '#fff', margin: 0, fontSize: 28, fontWeight: 700 },
  subtitle: { color: '#666', margin: 0, fontSize: 13 },
  input: { background: '#222', border: '1px solid #333', borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  primaryBtn: { background: '#5b5ef4', color: '#fff', border: 'none', borderRadius: 10, padding: '13px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer', width: '100%' },
  secondaryBtn: { background: '#222', color: '#aaa', border: '1px solid #333', borderRadius: 10, padding: '11px 20px', fontSize: 14, cursor: 'pointer', width: '100%' },
  subtextRow: { display: 'flex', gap: 8 },
  subtextBtn: { background: '#222', color: '#666', border: '1px solid #2a2a2a', borderRadius: 20, padding: '5px 16px', fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  subtextActive: { background: '#2a2a2a', color: '#f5a623', border: '1px solid #f5a623' },
  roomWrapper: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', background: '#111', borderBottom: '1px solid #222', zIndex: 10 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  roomTitle: { color: '#fff', fontWeight: 600, fontSize: 15 },
  pill: { background: '#222', color: '#888', borderRadius: 20, padding: '3px 10px', fontSize: 12 },
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
}
