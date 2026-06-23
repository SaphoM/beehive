import { useState, useEffect, useRef, useCallback } from 'react'

// Electron context bridge — only present when running inside the desktop app
declare global {
  interface Window {
    electronAPI?: {
      isElectron: true
      getFilePath: (file: File) => string
      openFile: (filePath: string) => Promise<string | null>
      getDesktopSources: (opts?: { types?: string[]; thumbnailSize?: { width: number; height: number } }) => Promise<Array<{ id: string; name: string; thumbnail: string; appIcon: string | null; display_id: string }>>
    }
  }
}
// Electron adds a .path property to File objects from drag-and-drop / file input
declare global { interface File { path?: string } }
import { PhoneOff, Link, Link2Off, Film, Hand, MessageSquare, Mic, MicOff, Video, VideoOff, X, Monitor, MonitorOff, MonitorX, ArrowLeftRight, CheckSquare, Square, Aperture, Crosshair, Users, Layers, FlipHorizontal, Upload, Paperclip, Download, FileText, EyeOff, Minus } from 'lucide-react'
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
import { Track, LocalVideoTrack } from 'livekit-client'
import '@livekit/components-styles'
import {
  useCreateRoom,
  useJoinRoom,
  useParticipants,
  useChat,
  useRecordings,
  useRoomInfo,
  useFathomMeetings,
  useFathomTranscript,
  supabase,
  type FathomMeeting,
  type FathomTranscriptLine,
} from './livekit_react_hooks'

const REACTIONS = ['👍', '❤️', '😂', '🎉', '👏', '🔥']
const QUALITY_OPTIONS = ['Low (360p)', 'Medium (720p)', 'High (1080p)']

const PRESENTATION_EXTS = ['.key', '.keynote', '.pptx', '.ppt', '.odp', '.pdf']
const PRESENTATION_APP: Record<string, string> = {
  '.key': 'Keynote', '.keynote': 'Keynote',
  '.pptx': 'PowerPoint', '.ppt': 'PowerPoint',
  '.odp': 'Impress',
  '.pdf': 'Preview',
}
function isPresentationFile(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return PRESENTATION_EXTS.includes(ext)
}
function presentationApp(name: string) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  return PRESENTATION_APP[ext] ?? 'the app'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileIcon(mime: string) {
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('tar') || mime.includes('gzip')) return '🗜️'
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return '📊'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📽️'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  return '📎'
}

// Load MediaPipe Selfie Segmentation from CDN (injected once, polled until ready)
async function ensureMediaPipe(): Promise<void> {
  if ((window as any).SelfieSegmentation) return
  if (!document.querySelector('script[data-mp-ss]')) {
    const s = document.createElement('script')
    s.setAttribute('data-mp-ss', '1')
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/selfie_segmentation.js'
    s.crossOrigin = 'anonymous'
    document.head.appendChild(s)
  }
  await new Promise<void>((resolve, reject) => {
    if ((window as any).SelfieSegmentation) { resolve(); return }
    const check = setInterval(() => {
      if ((window as any).SelfieSegmentation) { clearInterval(check); resolve() }
    }, 100)
    setTimeout(() => { clearInterval(check); reject(new Error('MediaPipe load timeout')) }, 20000)
  })
}

// Virtual background scene presets — drawn procedurally on canvas each frame
type VirtualPreset = { id: string; label: string; preview: string[] }
const VIRTUAL_PRESETS: VirtualPreset[] = [
  { id: 'office',    label: 'Office',    preview: ['#d6d3d1', '#a8a29e'] },
  { id: 'beach',     label: 'Beach',     preview: ['#0284c7', '#fbbf24'] },
  { id: 'city',      label: 'City',      preview: ['#0f172a', '#334155'] },
  { id: 'forest',    label: 'Forest',    preview: ['#14532d', '#15803d'] },
  { id: 'mountains', label: 'Mountains', preview: ['#312e81', '#4f46e5'] },
  { id: 'space',     label: 'Space',     preview: ['#030712', '#1e1b4b'] },
  { id: 'sunset',    label: 'Sunset',    preview: ['#7c3aed', '#f97316'] },
  { id: 'studio',    label: 'Studio',    preview: ['#27272a', '#18181b'] },
]

function drawVirtualScene(ctx: CanvasRenderingContext2D, id: string, W: number, H: number) {
  switch (id) {
    case 'office': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#e7e5e4'); g.addColorStop(1, '#a8a29e')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#78350f'; ctx.fillRect(0, H * 0.75, W, H * 0.25)
      ctx.fillStyle = '#6b2800'; ctx.fillRect(0, H * 0.74, W, 5)
      break
    }
    case 'beach': {
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62)
      sky.addColorStop(0, '#0369a1'); sky.addColorStop(1, '#38bdf8')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H * 0.62)
      ctx.fillStyle = '#0284c7'; ctx.fillRect(0, H * 0.57, W, H * 0.1)
      const sand = ctx.createLinearGradient(0, H * 0.65, 0, H)
      sand.addColorStop(0, '#fde68a'); sand.addColorStop(1, '#b45309')
      ctx.fillStyle = sand; ctx.fillRect(0, H * 0.65, W, H * 0.35)
      break
    }
    case 'city': {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#0f172a'); sky.addColorStop(1, '#1e293b')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
      const buildings = [
        { x: 0, w: 80, h: H * 0.55 }, { x: 70, w: 50, h: H * 0.4 },
        { x: 110, w: 90, h: H * 0.65 }, { x: 190, w: 60, h: H * 0.45 },
        { x: 240, w: 100, h: H * 0.7 }, { x: 330, w: 70, h: H * 0.5 },
        { x: 390, w: 120, h: H * 0.6 }, { x: 500, w: 80, h: H * 0.42 },
        { x: 570, w: 70, h: H * 0.68 },
      ]
      ctx.fillStyle = '#334155'
      buildings.forEach(b => ctx.fillRect(b.x, H - b.h, b.w, b.h))
      ctx.fillStyle = 'rgba(253,230,138,0.75)'
      buildings.forEach(b => {
        const cols = Math.floor(b.w / 14)
        const rows = Math.min(8, Math.floor(b.h / 18))
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            if (((row * 7 + col * 3) % 5) !== 0)
              ctx.fillRect(b.x + col * 14 + 3, H - b.h + row * 18 + 8, 6, 8)
          }
        }
      })
      break
    }
    case 'forest': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#14532d'); g.addColorStop(1, '#052e16')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#713f12'
      for (let i = 0; i < 8; i++) ctx.fillRect(i * 85 + 30, H * 0.35, 12, H * 0.65)
      ctx.fillStyle = '#166534'
      for (let i = 0; i < 8; i++) {
        ctx.beginPath(); ctx.arc(i * 85 + 36, H * 0.35, 44, 0, Math.PI * 2); ctx.fill()
      }
      break
    }
    case 'mountains': {
      const sky = ctx.createLinearGradient(0, 0, 0, H)
      sky.addColorStop(0, '#1e1b4b'); sky.addColorStop(1, '#4f46e5')
      ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#4338ca'
      ctx.beginPath()
      ctx.moveTo(0, H); ctx.lineTo(0, H * 0.5); ctx.lineTo(120, H * 0.2)
      ctx.lineTo(200, H * 0.45); ctx.lineTo(320, H * 0.1); ctx.lineTo(440, H * 0.4)
      ctx.lineTo(560, H * 0.15); ctx.lineTo(W, H * 0.5); ctx.lineTo(W, H)
      ctx.closePath(); ctx.fill()
      ctx.fillStyle = '#e0e7ff'
      ctx.beginPath(); ctx.moveTo(120, H * 0.2); ctx.lineTo(100, H * 0.32); ctx.lineTo(140, H * 0.32); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(320, H * 0.1); ctx.lineTo(298, H * 0.25); ctx.lineTo(342, H * 0.25); ctx.closePath(); ctx.fill()
      ctx.beginPath(); ctx.moveTo(560, H * 0.15); ctx.lineTo(540, H * 0.27); ctx.lineTo(580, H * 0.27); ctx.closePath(); ctx.fill()
      break
    }
    case 'space': {
      ctx.fillStyle = '#030712'; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#fff'
      let sx = 42, sy = 17
      for (let i = 0; i < 90; i++) {
        sx = (sx * 1664525 + 1013904223) & 0xffff
        sy = (sy * 22695477 + 1) & 0xffff
        const px = (sx / 0xffff) * W
        const py = (sy / 0xffff) * H
        const r = (((sx ^ sy) & 0xf) / 0xf) * 1.4 + 0.3
        ctx.globalAlpha = 0.6 + (((sx + sy) & 0xff) / 0xff) * 0.4
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
      break
    }
    case 'sunset': {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#581c87'); g.addColorStop(0.3, '#db2777')
      g.addColorStop(0.6, '#ea580c'); g.addColorStop(1, '#f97316')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      const sun = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, 55)
      sun.addColorStop(0, '#fef9c3'); sun.addColorStop(0.4, '#fef08a'); sun.addColorStop(1, 'rgba(249,115,22,0)')
      ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H)
      ctx.fillStyle = '#431407'; ctx.fillRect(0, H * 0.73, W, H * 0.27)
      break
    }
    case 'studio':
    default: {
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#27272a'); g.addColorStop(1, '#09090b')
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
      const spot = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.8)
      spot.addColorStop(0, 'rgba(255,255,255,0.07)'); spot.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = spot; ctx.fillRect(0, 0, W, H)
    }
  }
}

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
  const [showFathom, setShowFathom] = useState(false)
  const [lobbyTab, setLobbyTab] = useState<'now' | 'schedule'>('now')

  return (
    <div style={{ ...s.lobby, flexDirection: 'column', gap: 16 }}>
      <div style={s.lobbyCard}>
        <h1 style={s.title}>
          <span style={{ fontWeight: 400 }}>BEE</span>HIVE
        </h1>

        {/* Tab switcher — only show when no invite link */}
        {!hasInvite && (
          <div style={s.lobbyTabRow}>
            <button
              style={{ ...s.lobbyTab, ...(lobbyTab === 'now' ? s.lobbyTabActive : {}) }}
              onClick={() => setLobbyTab('now')}
            >
              Start Now
            </button>
            <button
              style={{ ...s.lobbyTab, ...(lobbyTab === 'schedule' ? s.lobbyTabActive : {}) }}
              onClick={() => setLobbyTab('schedule')}
            >
              Schedule
            </button>
          </div>
        )}

        {lobbyTab === 'schedule' && !hasInvite ? (
          <SchedulePanel displayName={displayName} onDisplayNameChange={onDisplayNameChange} />
        ) : (
          <>
            {hasInvite && inviteRoom ? (
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
          </>
        )}
      </div>

      {/* Fathom meetings toggle */}
      <button style={s.fathomToggleBtn} onClick={() => setShowFathom(v => !v)}>
        <span style={{ opacity: 0.5, fontSize: 11 }}>◆</span>
        Recent meetings
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{showFathom ? '▲' : '▼'}</span>
      </button>

      {showFathom && <FathomPanel />}
    </div>
  )
}

// ============================================================
// SCHEDULE PANEL
// ============================================================
function SchedulePanel({ displayName, onDisplayNameChange }: { displayName: string; onDisplayNameChange: (v: string) => void }) {
  const { createRoom, loading } = useCreateRoom()
  const [roomName, setRoomName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [emailInput, setEmailInput] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)

  const addEmail = () => {
    const e = emailInput.trim().toLowerCase()
    if (e && e.includes('@') && !emails.includes(e)) {
      setEmails(prev => [...prev, e])
      setEmailInput('')
    }
  }

  const removeEmail = (e: string) => setEmails(prev => prev.filter(x => x !== e))

  const handleCreate = async () => {
    if (!displayName.trim()) { alert('Enter your name first'); return }
    const name = roomName.trim() || (date ? `Meeting – ${new Date(date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'BeeHive Meeting')
    const room = await createRoom(name)
    if (!room) return
    const base = window.location.origin + window.location.pathname.replace(/\/$/, '')
    setLink(`${base}?room=${room.id}`)
  }

  const copyLink = () => {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sendEmails = () => {
    const subject = encodeURIComponent(`BeeHive Meeting: ${roomName || 'You’re invited'}`)
    let when = ''
    if (date) {
      const dt = new Date(`${date}T${time || '00:00'}`)
      when = dt.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) })
    }
    const body = encodeURIComponent(
      `Hi,\n\nYou're invited to a BeeHive video meeting.\n\n` +
      (roomName ? `Meeting: ${roomName}\n` : '') +
      (when ? `When: ${when}\n` : '') +
      `\nJoin here:\n${link}\n\n` +
      `— ${displayName || 'Your host'} via BeeHive`
    )
    window.open(`mailto:${emails.join(',')}?subject=${subject}&body=${body}`)
  }

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
      {/* Name */}
      <input
        style={s.input}
        placeholder="Your name"
        value={displayName}
        onChange={e => onDisplayNameChange(e.target.value)}
        autoFocus
      />

      {/* Meeting name */}
      <input
        style={s.input}
        placeholder="Meeting name (optional)"
        value={roomName}
        onChange={e => setRoomName(e.target.value)}
      />

      {/* Date + Time row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="date"
          min={todayStr}
          style={{ ...s.input, flex: 2, margin: 0, colorScheme: 'dark' as any }}
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <input
          type="time"
          style={{ ...s.input, flex: 1, margin: 0, colorScheme: 'dark' as any }}
          value={time}
          onChange={e => setTime(e.target.value)}
        />
      </div>

      {/* Email input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ ...s.input, flex: 1, margin: 0 }}
          placeholder="Add email address"
          type="email"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmail() } }}
        />
        <button
          style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#aaa', padding: '0 14px', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
          onClick={addEmail}
        >+</button>
      </div>

      {/* Email chips */}
      {emails.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
          {emails.map(e => (
            <span key={e} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 10px', fontSize: 12, color: '#ccc', fontFamily: "'Roboto', sans-serif" }}>
              {e}
              <button onClick={() => removeEmail(e)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Link result */}
      {link ? (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ flex: 1, color: '#aaa', fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{link}</span>
            <button onClick={copyLink} style={{ background: copied ? '#1a3a1a' : '#2a2a2a', border: `1px solid ${copied ? '#2d6a2d' : '#333'}`, borderRadius: 6, color: copied ? '#4caf50' : '#aaa', padding: '4px 10px', cursor: 'pointer', fontSize: 11, flexShrink: 0, fontFamily: "'Roboto', sans-serif" }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {emails.length > 0 && (
            <button
              style={{ ...s.primaryBtn, margin: 0, background: '#5b5ef4' }}
              onClick={sendEmails}
            >
              Send Email Invite{emails.length > 1 ? 's' : ''} ({emails.length})
            </button>
          )}
          {emails.length === 0 && (
            <p style={{ color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", margin: 0, textAlign: 'center' as const }}>
              Add email addresses above to send invites
            </p>
          )}
        </div>
      ) : (
        <button style={{ ...s.primaryBtn, margin: 0 }} onClick={handleCreate} disabled={loading}>
          {loading ? 'Creating…' : 'Create Meeting & Get Link'}
        </button>
      )}
    </div>
  )
}

// ============================================================
// FATHOM PANEL
// ============================================================
function fmtDuration(start?: string, end?: string): string {
  if (!start || !end) return ''
  const min = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (min < 60) return `${min}m`
  return `${Math.floor(min / 60)}h ${min % 60}m`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function getRecordingId(url: string): string | null {
  return url?.match(/recordings\/([a-zA-Z0-9_-]+)/)?.[1] ?? null
}

function FathomMeetingRow({ meeting }: { meeting: FathomMeeting }) {
  const [expanded, setExpanded] = useState(false)
  const [showTranscript, setShowTranscript] = useState(false)
  const recordingId = getRecordingId(meeting.url)
  const { transcript, loading: tLoading, loadTranscript } = useFathomTranscript(recordingId)
  const title = meeting.title || meeting.meeting_title || 'Untitled meeting'
  const duration = fmtDuration(meeting.recording_start_time, meeting.recording_end_time)
  const attendeeCount = meeting.calendar_invitees?.length ?? 0
  const hasContent = !!(meeting.default_summary?.markdown_formatted || meeting.action_items?.length)

  const handleTranscript = () => {
    if (!showTranscript && !transcript) loadTranscript()
    setShowTranscript(v => !v)
  }

  return (
    <div style={s.fathomRow}>
      {/* Meeting header */}
      <button style={s.fathomRowHeader} onClick={() => hasContent && setExpanded(v => !v)}>
        <div style={s.fathomRowMeta}>
          <span style={s.fathomRowDate}>{fmtDate(meeting.created_at)}</span>
          {duration && <span style={s.fathomRowDuration}>{duration}</span>}
          {attendeeCount > 0 && <span style={s.fathomRowDuration}>{attendeeCount} people</span>}
        </div>
        <div style={s.fathomRowTitle}>{title}</div>
        {meeting.recorded_by && (
          <div style={s.fathomRowRecordedBy}>Recorded by {meeting.recorded_by.name}</div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          {meeting.share_url && (
            <a href={meeting.share_url} target="_blank" rel="noreferrer" style={s.fathomLink}
               onClick={e => e.stopPropagation()}>
              Open ↗
            </a>
          )}
          {hasContent && (
            <span style={{ ...s.fathomChip, marginLeft: 'auto' }}>{expanded ? '▲' : '▼'}</span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={s.fathomDetail}>
          {/* AI Summary */}
          {meeting.default_summary?.markdown_formatted && (
            <div style={s.fathomSection}>
              <div style={s.fathomSectionTitle}>Summary</div>
              <div style={s.fathomSummaryText}>
                {meeting.default_summary.markdown_formatted}
              </div>
            </div>
          )}

          {/* Action Items */}
          {(meeting.action_items?.length ?? 0) > 0 && (
            <div style={s.fathomSection}>
              <div style={s.fathomSectionTitle}>Action Items</div>
              {meeting.action_items!.map((item, i) => (
                <div key={i} style={s.fathomActionItem}>
                  <span style={{ color: item.completed ? '#48bb78' : '#555', flexShrink: 0, fontSize: 13 }}>
                    {item.completed ? '✓' : '○'}
                  </span>
                  <span style={{
                    color: item.completed ? '#555' : '#ccc',
                    textDecoration: item.completed ? 'line-through' : 'none',
                    flex: 1, fontSize: 13,
                  }}>
                    {item.description}
                  </span>
                  {item.assignee && (
                    <span style={s.fathomAssignee}>→ {item.assignee.name.split(' ')[0]}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Transcript toggle */}
          {recordingId && (
            <button style={s.fathomTranscriptToggle} onClick={handleTranscript}>
              {tLoading ? 'Loading…' : showTranscript ? '▲ Hide transcript' : '▼ View transcript'}
            </button>
          )}

          {showTranscript && transcript && (
            <div style={s.fathomTranscript}>
              {transcript.map((line: FathomTranscriptLine, i: number) => (
                <div key={i} style={s.fathomTranscriptLine}>
                  <span style={s.fathomTranscriptTime}>{line.timestamp}</span>
                  <span style={s.fathomTranscriptSpeaker}>{line.speaker.display_name}</span>
                  <span style={s.fathomTranscriptText}>{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FathomPanel() {
  const { meetings, loading, error, hasMore, loadMore } = useFathomMeetings(8)

  const errorMsg = error
    ? (error.includes('not configured') || error.includes('503'))
      ? 'Add FATHOM_API_KEY to .env to connect.'
      : (error.includes('timed out') || error.includes('502'))
        ? 'Fathom is temporarily unavailable — try again shortly.'
        : `Could not load meetings: ${error}`
    : null

  return (
    <div style={s.fathomPanel}>
      <div style={s.fathomHeader}>
        <span style={s.fathomHeaderTitle}>◆ FATHOM</span>
        <a href="https://app.fathom.video" target="_blank" rel="noreferrer" style={s.fathomLink}>
          Open Fathom ↗
        </a>
      </div>

      {errorMsg && (
        <div style={{ ...s.fathomEmpty, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <span>{errorMsg}</span>
          <button style={s.fathomRetryBtn} onClick={loadMore}>Retry</button>
        </div>
      )}

      {!errorMsg && loading && meetings.length === 0 && (
        <div style={s.fathomEmpty}>Loading…</div>
      )}

      {!errorMsg && !loading && meetings.length === 0 && (
        <div style={s.fathomEmpty}>No Fathom meetings found.</div>
      )}

      {!errorMsg && (
        <div style={s.fathomList}>
          {meetings.map((m, i) => <FathomMeetingRow key={m.url ?? i} meeting={m} />)}
        </div>
      )}

      {hasMore && (
        <button style={s.fathomLoadMore} onClick={loadMore} disabled={loading}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
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
  // Remote screen share tracks — when present, take over the full main area
  const remoteScreenTracks = allTracks.filter(t =>
    t.source === Track.Source.ScreenShare &&
    t.participant.identity !== localParticipant.identity
  )
  const hasRemoteScreenShare = remoteScreenTracks.length > 0
  const cameraTracks = tracks.filter(t => t.source !== Track.Source.ScreenShare)
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

  // File share state
  const [dragOver, setDragOver] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [fileMode, setFileMode] = useState<'share' | 'present'>('share')
  const [fileRecipients, setFileRecipients] = useState<'all' | string[]>('all')
  const [fileUploading, setFileUploading] = useState(false)
  const [presentStep, setPresentStep] = useState<'idle' | 'opening' | 'waiting'>('idle')
  const [presentAppName, setPresentAppName] = useState('')
  const [desktopSources, setDesktopSources] = useState<Array<{ id: string; name: string; thumbnail: string; appIcon: string | null; display_id: string }>>([])
  const [showWindowPicker, setShowWindowPicker] = useState(false)
  const [pendingSource, setPendingSource] = useState<{ id: string; name: string; thumbnail: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [presentQueue, setPresentQueue] = useState<File[]>([])
  const queueInputRef = useRef<HTMLInputElement>(null)

  // Window-level drag listeners — child <video> elements swallow React div-level events
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) setDragOver(true)
    }
    const onDragOver = (e: DragEvent) => { e.preventDefault() }
    const onDragLeave = (e: DragEvent) => {
      if (!e.relatedTarget || (e.relatedTarget as Node).nodeName === 'HTML') setDragOver(false)
    }
    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer?.files[0]
      if (!file) return
      // Present mode only available in the Electron desktop app
      if (window.electronAPI && isPresentationFile(file.name)) {
        setPendingFile(file)
        setFileMode('present')
        setPresentStep('idle')
      } else {
        setPendingFile(file)
        setFileMode('share')
        setFileRecipients('all')
      }
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // Background effects state
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [bgEffect, setBgEffect] = useState<'none' | 'blur' | 'image' | 'virtual'>('none')
  const [bgFlip, setBgFlip] = useState(false)
  const [blurLevel, setBlurLevel] = useState(8)
  const [bgPresetId, setBgPresetId] = useState('studio')
  const bgOrigTrackRef = useRef<MediaStreamTrack | null>(null)
  const bgUploadedImageRef = useRef<HTMLImageElement | null>(null)
  const [bgUploadedImageName, setBgUploadedImageName] = useState('')
  // bgStateRef lets the render loop read latest settings without restarting the pipeline
  const bgStateRef = useRef({ effect: bgEffect, flip: bgFlip, blurLevel, presetId: bgPresetId })
  bgStateRef.current = { effect: bgEffect, flip: bgFlip, blurLevel, presetId: bgPresetId }

  const bgActive = bgEffect !== 'none' || bgFlip

  const handleImageUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { bgUploadedImageRef.current = img; URL.revokeObjectURL(url) }
    img.src = url
    setBgUploadedImageName(file.name)
    setBgEffect('image')
  }, [])

  useEffect(() => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera)
    const lkTrack = pub?.track
    if (!lkTrack) return

    if (!bgActive) {
      if (bgOrigTrackRef.current) {
        ;(lkTrack as any).replaceTrack(bgOrigTrackRef.current).catch(() => {})
        bgOrigTrackRef.current = null
      }
      return
    }

    const raw = (lkTrack as any).mediaStreamTrack as MediaStreamTrack | undefined
    if (!raw) return
    if (!bgOrigTrackRef.current) bgOrigTrackRef.current = raw

    const W = 640, H = 480
    let running = true
    let seg: any = null

    const video = document.createElement('video')
    video.srcObject = new MediaStream([bgOrigTrackRef.current])
    video.playsInline = true; video.muted = true

    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')!

    // Offscreen canvas — holds the person cutout before compositing
    const offCanvas = document.createElement('canvas')
    offCanvas.width = W; offCanvas.height = H
    const offCtx = offCanvas.getContext('2d')!

    let trackReplaced = false

    const onResults = (results: any) => {
      if (!running) return
      const { effect, flip, blurLevel: bl, presetId } = bgStateRef.current

      ctx.save()
      ctx.clearRect(0, 0, W, H)
      if (flip) { ctx.translate(W, 0); ctx.scale(-1, 1) }

      if (effect === 'blur') {
        ctx.filter = `blur(${bl}px)`
        ctx.drawImage(video, 0, 0, W, H)
        ctx.filter = 'none'
      } else if (effect === 'image') {
        const img = bgUploadedImageRef.current
        if (img) {
          // Cover-fit: crop to fill canvas
          const ia = img.width / img.height, ca = W / H
          let sx = 0, sy = 0, sw = img.width, sh = img.height
          if (ia > ca) { sw = img.height * ca; sx = (img.width - sw) / 2 }
          else { sh = img.width / ca; sy = (img.height - sh) / 2 }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H)
        } else {
          ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H)
        }
      } else if (effect === 'virtual') {
        drawVirtualScene(ctx, presetId, W, H)
      } else {
        // flip-only: no background replacement, draw video normally
        ctx.drawImage(video, 0, 0, W, H)
      }

      // Cut person out of video using segmentation mask, composite over background
      if (effect !== 'none') {
        offCtx.clearRect(0, 0, W, H)
        offCtx.drawImage(video, 0, 0, W, H)
        offCtx.globalCompositeOperation = 'destination-in'
        offCtx.drawImage(results.segmentationMask, 0, 0, W, H)
        offCtx.globalCompositeOperation = 'source-over'
        ctx.drawImage(offCanvas, 0, 0)
      }

      ctx.restore()

      if (!trackReplaced) {
        trackReplaced = true
        const [canvasTrack] = canvas.captureStream(30).getVideoTracks()
        ;(lkTrack as any).replaceTrack(canvasTrack).catch(() => {})
      }
    }

    const init = async () => {
      try { await ensureMediaPipe() } catch { return }
      if (!running) return

      seg = new (window as any).SelfieSegmentation({
        locateFile: (f: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1/${f}`,
      })
      seg.setOptions({ modelSelection: 1 })
      seg.onResults(onResults)

      await video.play().catch(() => {})

      const sendFrame = async () => {
        if (!running) return
        if (video.readyState >= 2) {
          try { await seg.send({ image: video }) } catch {}
        }
        if (running) requestAnimationFrame(sendFrame)
      }
      sendFrame()
    }

    init()

    return () => {
      running = false
      video.srcObject = null
      try { seg?.close() } catch {}
      if (bgOrigTrackRef.current) {
        ;(lkTrack as any).replaceTrack(bgOrigTrackRef.current).catch(() => {})
      }
    }
  }, [bgActive, localParticipant])

  // Auto-open participants window when a remote screen share starts
  useEffect(() => {
    if (hasRemoteScreenShare) setShowParticipants(true)
  }, [hasRemoteScreenShare])

  // Auto cam state
  const [autoCamMode, setAutoCamMode] = useState<'center' | 'split' | null>(null)
  const [showAutoCamMenu, setShowAutoCamMenu] = useState(false)

  // Screen share state
  const [shareMenu, setShareMenu] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [localShareStream, setLocalShareStream] = useState<MediaStream | null>(null)
  const [clearBeforeShare, setClearBeforeShare] = useState(false)
  const [shareLabel, setShareLabel] = useState('')
  const [secondaryStream, setSecondaryStream] = useState<MediaStream | null>(null)
  const [activeSlot, setActiveSlot] = useState<'primary' | 'secondary'>('primary')
  const [roomHidden, setRoomHidden] = useState(false)
  const stopShareRef = useRef<() => void>()

  // Presentation overlay — must be after isSharing and hasRemoteScreenShare are declared
  const [overlayMode, setOverlayMode] = useState<'visible' | 'minimized' | 'hidden'>('visible')
  const isPresenting = isSharing || hasRemoteScreenShare

  useEffect(() => {
    if (!isPresenting) setOverlayMode('visible')
  }, [isPresenting])

  const stopShare = useCallback(async () => {
    try { await localParticipant.setScreenShareEnabled(false) } catch {}
    secondaryStream?.getTracks().forEach(t => t.stop())
    localShareStream?.getTracks().forEach(t => t.stop())
    setSecondaryStream(null)
    setLocalShareStream(null)
    setIsSharing(false)
    setShareLabel('')
    setActiveSlot('primary')
  }, [localParticipant, secondaryStream, localShareStream])

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
      const mediaTrack = (pub?.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined
      const label = mediaTrack?.label || 'Your screen'
      if (mediaTrack) {
        const stream = new MediaStream([mediaTrack])
        setLocalShareStream(stream)
        mediaTrack.addEventListener('ended', () => stopShareRef.current?.())
      }
      setShareLabel(label)
      setIsSharing(true)
      setShareMenu(false)
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

  // Mark participant inactive and broadcast leave notification, then exit
  const leaveWithNotification = useCallback(async () => {
    try {
      await supabase.from('chat_messages').insert({ room_id: roomId, sender_name: '__SYSTEM__', content: `__LEAVE__${displayName}` })
      await supabase.from('room_participants').update({ is_active: false }).eq('room_id', roomId).eq('display_name', displayName)
    } catch { /* best-effort */ }
    onLeave()
  }, [roomId, displayName, onLeave])

  // Send join notification once on mount
  useEffect(() => {
    supabase.from('chat_messages').insert({ room_id: roomId, sender_name: '__SYSTEM__', content: `__JOIN__${displayName}` }).then(() => {})
    return () => {
      // Mark inactive on unmount (covers LiveKit onDisconnected path)
      supabase.from('room_participants').update({ is_active: false }).eq('room_id', roomId).eq('display_name', displayName).then(() => {})
    }
  }, [roomId, displayName])

  // Auto-end call if user is alone for 10 minutes
  const aloneStartRef = useRef<number | null>(null)
  const [aloneCountdown, setAloneCountdown] = useState<number | null>(null)
  const ALONE_LIMIT = 10 * 60 * 1000 // 10 minutes
  const WARN_AT = 60 * 1000           // warn at 1 minute remaining

  useEffect(() => {
    const activeCount = participants.filter(p => p.is_active).length
    if (activeCount <= 1) {
      if (aloneStartRef.current === null) aloneStartRef.current = Date.now()
    } else {
      aloneStartRef.current = null
      setAloneCountdown(null)
    }
  }, [participants])

  useEffect(() => {
    const interval = setInterval(() => {
      if (aloneStartRef.current === null) return
      const elapsed = Date.now() - aloneStartRef.current
      const remaining = ALONE_LIMIT - elapsed
      if (remaining <= 0) {
        clearInterval(interval)
        leaveWithNotification()
      } else if (remaining <= WARN_AT) {
        setAloneCountdown(Math.ceil(remaining / 1000))
      } else {
        setAloneCountdown(null)
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [leaveWithNotification])

  const openAndShare = useCallback(async () => {
    if (!pendingFile) return

    if (window.electronAPI) {
      // Open the file natively; then wait for the user to enter presentation mode
      setPresentStep('opening')
      setPresentAppName(presentationApp(pendingFile.name))
      const filePath = window.electronAPI.getFilePath(pendingFile)
      if (filePath) {
        const err = await window.electronAPI.openFile(filePath)
        if (err) console.warn('[electron] openFile error:', err)
      } else {
        console.warn('[electron] getFilePath returned empty — file may not have a local path')
      }
      // Brief pause so the OS has time to launch the app before we show the waiting UI
      await new Promise(r => setTimeout(r, 1200))
      setPresentStep('waiting') // modal stays open — user sets up slideshow
    } else {
      // Browser: trigger OS screen-picker directly
      setPresentStep('opening')
      setPendingFile(null)
      await new Promise(r => setTimeout(r, 150))
      setPresentStep('idle')
      await startShare()
    }
  }, [pendingFile, startShare])

  // Auto-detect the Keynote / PowerPoint window by name and share it directly
  const shareDesktopSource = useCallback(async (sourceId: string) => {
    setShowWindowPicker(false)
    try {
      // Electron: capture the specific window without the OS picker
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore — Electron-specific mandatory constraints
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            maxWidth: 1920,
            minHeight: 720,
            maxHeight: 1080,
          },
        },
      })
      const [rawTrack] = stream.getVideoTracks()
      if (!rawTrack) return

      // Publish directly — do NOT call setScreenShareEnabled (that opens the OS picker)
      const livekitTrack = new LocalVideoTrack(rawTrack, undefined, false)
      await localParticipant.publishTrack(livekitTrack, { source: Track.Source.ScreenShare })

      setLocalShareStream(stream)
      setShareLabel(rawTrack.label || 'Presentation')
      setIsSharing(true)
      rawTrack.addEventListener('ended', () => stopShareRef.current?.())
    } catch (e) {
      console.error('[electron] shareDesktopSource error:', e)
    }
  }, [localParticipant])

  const sharePresentationWindow = useCallback(async () => {
    if (!window.electronAPI) return
    setPresentStep('opening')
    const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })

    const keywords = ['keynote', 'powerpoint', 'impress', 'slides']
    const match = sources.find(s =>
      keywords.some(kw => s.name.toLowerCase().includes(kw))
    )

    setPresentStep('waiting')
    if (match) {
      // Show preview for confirmation before sharing
      setPendingSource({ id: match.id, name: match.name, thumbnail: match.thumbnail })
    } else {
      // Nothing matched — fall back to picker
      setDesktopSources(sources)
      setShowWindowPicker(true)
    }
  }, [])

  const confirmAndShare = useCallback(async () => {
    if (!pendingSource) return
    setPendingFile(null)
    setPresentStep('idle')
    const id = pendingSource.id
    setPendingSource(null)
    await shareDesktopSource(id)
  }, [pendingSource, shareDesktopSource])

  // Open a queued file in its native app then detect + preview the window
  const openQueuedFile = useCallback(async (file: File) => {
    if (!window.electronAPI) return
    const filePath = window.electronAPI.getFilePath(file)
    if (filePath) {
      const err = await window.electronAPI.openFile(filePath)
      if (err) console.warn('[electron] openFile error:', err)
    }
    await new Promise(r => setTimeout(r, 1200))
    // Reuse sharePresentationWindow flow — it will set pendingSource for preview
    const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
    const keywords = ['keynote', 'powerpoint', 'impress', 'slides']
    const match = sources.find(s => keywords.some(kw => s.name.toLowerCase().includes(kw)))
    if (match) {
      setPendingSource({ id: match.id, name: match.name, thumbnail: match.thumbnail })
    } else {
      setDesktopSources(sources)
      setShowWindowPicker(true)
    }
  }, [])

  const handleFileShare = async () => {
    if (!pendingFile) return
    setFileUploading(true)
    const path = `${roomId}/${Date.now()}-${pendingFile.name}`
    const { data, error } = await supabase.storage.from('shared-files').upload(path, pendingFile)
    if (error || !data) {
      alert('Upload failed — ' + (error?.message ?? 'unknown error'))
      setFileUploading(false)
      return
    }
    const { data: { publicUrl } } = supabase.storage.from('shared-files').getPublicUrl(data.path)
    const recipientList = fileRecipients === 'all' ? ['__all__'] : fileRecipients
    const payload = JSON.stringify({ name: pendingFile.name, url: publicUrl, size: pendingFile.size, mime: pendingFile.type, recipients: recipientList })
    await sendMessage(`__FILE__${payload}`, displayName)
    setFileUploading(false)
    setPendingFile(null)
    setFileRecipients('all')
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
      <div style={{ ...s.header, paddingLeft: window.electronAPI ? 88 : 18 }}>
        <div style={s.headerLeft}>
          <span style={s.roomTitle}>{APP_NAME}</span>
          <button style={s.pill} onClick={() => setShowParticipants(v => !v)}>
            {activeCount} {activeCount === 1 ? 'participant' : 'participants'}
          </button>
        </div>
        <div style={s.headerRight}>
          {isSharing && (
            <button
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#276127', border: '1px solid #48bb78', borderRadius: 8, color: '#48bb78', padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
              onClick={stopShare}
              title="Stop sharing"
            >
              <MonitorOff size={14} /> Stop Sharing
            </button>
          )}
          <button style={s.iconBtn} onClick={() => setShowChat(v => !v)} title="Toggle chat">
            <MessageSquare size={18} />
          </button>
          <button style={s.leaveBtn} onClick={leaveWithNotification}>Leave</button>
        </div>
      </div>

      {/* Alone countdown banner */}
      {aloneCountdown !== null && (
        <div style={{ background: '#1a1200', borderBottom: '1px solid #f5a623', padding: '8px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ color: '#f5a623', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif" }}>
            You're alone in this meeting. Call ends in <strong>{aloneCountdown}s</strong>.
          </span>
          <button
            style={{ background: 'none', border: '1px solid #444', borderRadius: 6, color: '#888', padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
            onClick={() => { aloneStartRef.current = Date.now(); setAloneCountdown(null) }}
          >
            Stay
          </button>
        </div>
      )}

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

        {/* Full-screen drop overlay — fixed so it covers LiveKit video tiles */}
        {dragOver && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(245,166,35,0.1)', border: '3px dashed #f5a623', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, pointerEvents: 'none' }}>
            <Paperclip size={48} color="#f5a623" />
            <span style={{ color: '#f5a623', fontSize: 18, fontWeight: 300, fontFamily: "'Roboto', sans-serif", letterSpacing: 1 }}>Drop to share with attendees</span>
            <span style={{ color: '#f5a623', fontSize: 13, fontWeight: 300, fontFamily: "'Roboto', sans-serif", opacity: 0.7 }}>Presentation files open automatically for window sharing</span>
          </div>
        )}

        {/* Video Grid */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {hasRemoteScreenShare ? (
            <ParticipantTile
              trackRef={remoteScreenTracks[0]}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : isSharing ? (
            /* Local share — live preview of what attendees see */
            <div style={{ width: '100%', height: '100%', position: 'relative', background: '#060606' }}>
              {localShareStream ? (
                <video
                  ref={el => { if (el && el.srcObject !== localShareStream) { el.srcObject = localShareStream; el.play().catch(() => {}) } }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  muted
                  playsInline
                  autoPlay
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <Monitor size={26} color="#48bb78" />
                  <p style={{ color: '#48bb78', fontSize: 14, fontWeight: 300, fontFamily: "'Roboto', sans-serif", margin: 0 }}>Broadcasting…</p>
                </div>
              )}
              {/* Live badge */}
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', border: '1px solid #48bb78', borderRadius: 20, padding: '4px 10px' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#48bb78', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <span style={{ color: '#48bb78', fontSize: 11, fontWeight: 600, fontFamily: "'Roboto', sans-serif", letterSpacing: 1 }}>LIVE</span>
              </div>
            </div>
          ) : (
            <GridLayout tracks={cameraTracks} style={{ height: '100%' }}>
              <ParticipantTile />
            </GridLayout>
          )}

          {/* Active Share Bar — hidden when overlay is hidden */}
          {isSharing && overlayMode !== 'hidden' && (
            <ScreenShareBar
              label={shareLabel}
              hasSecondary={!!secondaryStream}
              activeSlot={activeSlot}
              onAddWindow={addWindow}
              onSwitch={switchSource}
              onStop={stopShare}
            />
          )}

          {/* Auto Cam Window */}
          {autoCamMode && overlayMode !== 'hidden' && (
            <AutoCamWindow
              mode={autoCamMode}
              onModeChange={setAutoCamMode}
              onClose={() => { setAutoCamMode(null); setShowAutoCamMenu(false) }}
            />
          )}

          {/* Speaking Indicator — hidden when overlay is hidden */}
          <SpeakingIndicator overlayMode={isPresenting ? overlayMode : 'visible'} />

          {/* Floating Reactions */}
          <div style={s.reactionFloat}>
            {floatingReactions.map(r => (
              <span key={r.id} style={s.floatingEmoji}>{r.emoji}</span>
            ))}
          </div>

          {/* Restore pill — shown when overlay is hidden during presentation */}
          {isPresenting && overlayMode === 'hidden' && (
            <button
              onClick={() => setOverlayMode('visible')}
              style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)', border: '1px solid #f5a623', borderRadius: 30, padding: '7px 18px', color: '#f5a623', fontSize: 12, fontFamily: "'Roboto', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, zIndex: 20 }}
            >
              <Monitor size={14} /> Show controls
            </button>
          )}

          {/* Controls Bar — minimized pill or full bar */}
          {isPresenting && overlayMode === 'minimized' ? (
            <div style={{ ...s.controls, gap: 8, padding: '8px 14px' }}>
              <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} showIcon />
              <TrackToggle source={Track.Source.Camera} style={s.controlBtn} showIcon />
              {isSharing && (
                <button style={{ ...s.controlBtn, background: '#276127', border: '1px solid #48bb78' }} onClick={stopShare} title="Stop sharing"><MonitorOff size={20} /></button>
              )}
              <div style={{ width: 1, height: 22, background: '#333' }} />
              <button onClick={() => setOverlayMode('visible')} style={{ ...s.controlBtn, fontSize: 16 }} title="Expand">⤢</button>
              <button onClick={() => setOverlayMode('hidden')} style={{ ...s.controlBtn }} title="Hide controls"><EyeOff size={18} /></button>
              <button style={{ ...s.controlBtn, background: '#c53030' }} onClick={leaveWithNotification} title="Leave"><PhoneOff size={20} /></button>
            </div>
          ) : overlayMode !== 'hidden' ? (
          <div style={s.controls}>
            {/* Mic */}
            <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} showIcon />

            {/* Cam */}
            <TrackToggle source={Track.Source.Camera} style={s.controlBtn} showIcon />

            {/* Background Effects */}
            <div style={{ position: 'relative' }}>
              <button
                style={{ ...s.controlBtn, ...(bgActive ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                onClick={() => setBgMenuOpen(v => !v)}
                title="Background effects"
              >
                <Layers size={20} />
              </button>
              {bgMenuOpen && (
                <BackgroundMenu
                  effect={bgEffect}
                  presetId={bgPresetId}
                  flip={bgFlip}
                  blurLevel={blurLevel}
                  uploadedImageName={bgUploadedImageName}
                  onEffect={e => { setBgEffect(e); if (e === 'none') setBgFlip(false) }}
                  onPreset={setBgPresetId}
                  onFlip={() => setBgFlip(v => !v)}
                  onBlur={setBlurLevel}
                  onImageUpload={handleImageUpload}
                  onClose={() => setBgMenuOpen(false)}
                />
              )}
            </div>

            {/* Auto Cam */}
            <div style={{ position: 'relative' }}>
              <button
                style={{ ...s.controlBtn, ...(autoCamMode ? { background: '#1a2e4a', border: '1px solid #4299e1' } : {}) }}
                onClick={() => {
                  if (autoCamMode) { setAutoCamMode(null); setShowAutoCamMenu(false) }
                  else setShowAutoCamMenu(v => !v)
                }}
                title="Auto cam"
              >
                <Aperture size={20} />
              </button>
              {showAutoCamMenu && !autoCamMode && (
                <div style={s.autoCamMenu}>
                  <div style={s.shareMenuHeader}>
                    <span style={s.shareMenuTitle}>Auto Cam</span>
                    <button style={s.shareMenuClose} onClick={() => setShowAutoCamMenu(false)}><X size={14} /></button>
                  </div>
                  <button style={s.shareMenuOption} onClick={() => { setAutoCamMode('center'); setShowAutoCamMenu(false) }}>
                    <Crosshair size={15} color="#aaa" /><span>Auto Centre</span>
                  </button>
                  <button style={s.shareMenuOption} onClick={() => { setAutoCamMode('split'); setShowAutoCamMenu(false) }}>
                    <Users size={15} color="#aaa" /><span>2 in 1</span>
                  </button>
                </div>
              )}
            </div>

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

            {/* Stop Sharing pill — visible on both web and desktop when actively sharing */}
            {isSharing && (
              <button
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#c53030', border: 'none', borderRadius: 24, color: '#fff', padding: '0 16px', height: 48, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Roboto', sans-serif", whiteSpace: 'nowrap' }}
                onClick={stopShare}
                title="Stop sharing"
              >
                <MonitorOff size={16} /> Stop Sharing
              </button>
            )}

            {/* Leave */}
            <button style={{ ...s.controlBtn, background: '#c53030' }} onClick={leaveWithNotification} title="Leave">
              <PhoneOff size={20} />
            </button>

            {/* Presentation overlay controls — minimize / hide */}
            {isPresenting && (
              <>
                <div style={{ width: 1, height: 22, background: '#333' }} />
                <button onClick={() => setOverlayMode('minimized')} style={s.controlBtn} title="Minimise controls">
                  <Minus size={18} />
                </button>
                <button onClick={() => setOverlayMode('hidden')} style={s.controlBtn} title="Hide from presentation screen">
                  <EyeOff size={18} />
                </button>
              </>
            )}
          </div>
          ) : null}
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
              {messages.map(m => {
                if (m.message.startsWith('__JOIN__') || m.message.startsWith('__LEAVE__')) {
                  const isJoin = m.message.startsWith('__JOIN__')
                  const name = m.message.slice(8)
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', padding: '2px 0' }}>
                      <div style={{ flex: 1, height: 1, background: '#222' }} />
                      <span style={{ color: isJoin ? '#48bb78' : '#888', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", whiteSpace: 'nowrap' as const }}>
                        {isJoin ? `${name} joined` : `${name} left`}
                      </span>
                      <div style={{ flex: 1, height: 1, background: '#222' }} />
                    </div>
                  )
                }
                if (m.message.startsWith('__FILE__')) {
                  let meta: { name: string; url: string; size: number; mime: string; recipients: string[] } | null = null
                  try { meta = JSON.parse(m.message.slice(8)) } catch { return null }
                  if (!meta) return null
                  const isForMe = meta.recipients.includes('__all__') || meta.recipients.includes(displayName)
                  if (!isForMe) return null
                  return (
                    <div key={m.id} style={s.fileCard}>
                      <span style={s.msgName}>{m.display_name} shared a file</span>
                      <a href={meta.url} target="_blank" rel="noreferrer" download={meta.name} style={s.fileCardLink}>
                        <span style={{ fontSize: 18 }}>{fileIcon(meta.mime)}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{meta.name}</span>
                        <span style={{ color: '#555', fontSize: 11, flexShrink: 0 }}>{formatBytes(meta.size)}</span>
                        <Download size={14} color="#5b5ef4" style={{ flexShrink: 0 }} />
                      </a>
                      {!meta.recipients.includes('__all__') && (
                        <span style={{ color: '#555', fontSize: 11 }}>To: {meta.recipients.join(', ')}</span>
                      )}
                      <span style={s.msgTime}>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )
                }
                return (
                  <div key={m.id} style={s.message}>
                    <span style={s.msgName}>{m.display_name}</span>
                    <span style={s.msgText}>{m.message}</span>
                    <span style={s.msgTime}>
                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )
              })}
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
              <button
                style={{ ...s.sendBtn, background: 'transparent', color: '#666', width: 34 }}
                title="Share a file"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={16} />
              </button>
              <button style={s.sendBtn} onClick={handleSend}>↑</button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files?.[0]
                if (!file) return
                if (window.electronAPI && isPresentationFile(file.name)) {
                  setPendingFile(file); setFileMode('present'); setPresentStep('idle')
                } else {
                  setPendingFile(file); setFileMode('share'); setFileRecipients('all')
                }
                e.target.value = ''
              }}
            />

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

      {/* File Modal — present mode or share mode */}
      {pendingFile && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 28, width: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 400, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5 }}>
                {fileMode === 'present' ? 'Present File' : 'Share File'}
              </span>
              <button style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex' }} onClick={() => { setPendingFile(null); setPresentStep('idle'); setPresentQueue([]) }}>
                <X size={18} />
              </button>
            </div>

            {/* File preview card */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '12px 14px' }}>
              <span style={{ fontSize: 28 }}>{fileIcon(pendingFile.type)}</span>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: '#ddd', fontSize: 13, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{pendingFile.name}</div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{formatBytes(pendingFile.size)}</div>
              </div>
            </div>

            {fileMode === 'present' ? (
              /* ── PRESENT mode ── */
              <>
                {presentStep === 'waiting' ? (
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
                    {pendingSource ? (
                      /* ── Preview confirmation ── */
                      <>
                        <p style={{ color: '#aaa', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: 0, letterSpacing: 0.3 }}>
                          This is what attendees will see:
                        </p>
                        <div style={{ borderRadius: 10, overflow: 'hidden', border: '2px solid #f5a623', lineHeight: 0 }}>
                          <img src={pendingSource.thumbnail} alt="Preview" style={{ width: '100%', display: 'block' }} />
                        </div>
                        <p style={{ color: '#888', fontSize: 12, fontFamily: "'Roboto', sans-serif", margin: 0, textAlign: 'center' as const }}>
                          {pendingSource.name}
                        </p>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            style={{ flex: 1, background: '#f5a623', color: '#000', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
                            onClick={confirmAndShare}
                          >
                            Confirm & Share
                          </button>
                          <button
                            style={{ background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: 10, padding: '11px 14px', fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
                            onClick={() => { setPendingSource(null); setDesktopSources([]); setShowWindowPicker(true) }}
                          >
                            Wrong window?
                          </button>
                        </div>
                      </>
                    ) : (
                      /* ── Waiting for user to enter slideshow mode ── */
                      <>
                        <p style={{ color: '#f5a623', fontSize: 13, fontWeight: 600, fontFamily: "'Roboto', sans-serif", margin: 0 }}>
                          {presentAppName} is opening…
                        </p>
                        <p style={{ color: '#aaa', fontSize: 13, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: '0 0 4px', lineHeight: 1.7 }}>
                          Enter <strong style={{ color: '#fff' }}>Presentation / Slideshow mode</strong> in {presentAppName}, then click <strong style={{ color: '#f5a623' }}>Share</strong> next to it.
                        </p>

                        {/* File queue — current + added files */}
                        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                          {/* Primary file */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '8px 10px' }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                            <span style={{ flex: 1, color: '#ddd', fontSize: 12, fontFamily: "'Roboto', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{pendingFile.name}</span>
                            <button
                              style={{ background: '#f5a623', border: 'none', borderRadius: 7, color: '#000', padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                              onClick={sharePresentationWindow}
                            >Share</button>
                          </div>

                          {/* Queued additional files */}
                          {presentQueue.map((qf, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '8px 10px' }}>
                              <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                              <span style={{ flex: 1, color: '#ddd', fontSize: 12, fontFamily: "'Roboto', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{qf.name}</span>
                              <button
                                style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 7, color: '#aaa', padding: '5px 10px', fontSize: 11, cursor: 'pointer', flexShrink: 0, marginRight: 4 }}
                                onClick={() => openQueuedFile(qf)}
                              >Open</button>
                              <button
                                style={{ background: '#f5a623', border: 'none', borderRadius: 7, color: '#000', padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}
                                onClick={() => openQueuedFile(qf)}
                              >Share</button>
                              <button
                                style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
                                onClick={() => setPresentQueue(q => q.filter((_, j) => j !== i))}
                              ><X size={13} /></button>
                            </div>
                          ))}

                          {/* Add file button */}
                          <button
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'transparent', border: '1px dashed #333', borderRadius: 10, padding: '8px 0', color: '#666', fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
                            onClick={() => queueInputRef.current?.click()}
                          >
                            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Add another file
                          </button>
                          <input
                            ref={queueInputRef}
                            type="file"
                            accept=".key,.keynote,.pptx,.ppt,.odp,.pdf"
                            style={{ display: 'none' }}
                            onChange={e => {
                              const f = e.target.files?.[0]
                              if (f) setPresentQueue(q => [...q, f])
                              e.target.value = ''
                            }}
                          />
                        </div>

                        <button
                          style={{ background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 0', fontSize: 13, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
                          onClick={() => { setPendingFile(null); setPresentStep('idle'); setPresentQueue([]) }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  /* Initial state — offer to open the file */
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                      {window.electronAPI ? (
                        <p style={{ color: '#aaa', fontSize: 13, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: 0, lineHeight: 1.6 }}>
                          Click <strong style={{ color: '#f5a623' }}>Open in {presentationApp(pendingFile.name)}</strong> — BeeHive will launch the file. Enter presentation mode, then click <strong style={{ color: '#fff' }}>Share Presentation</strong> to broadcast it to attendees automatically.
                        </p>
                      ) : (
                        <p style={{ color: '#aaa', fontSize: 13, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: 0, lineHeight: 1.6 }}>
                          Open <strong style={{ color: '#fff' }}>{pendingFile.name}</strong> in {presentationApp(pendingFile.name)}, then click <strong style={{ color: '#fff' }}>Share Window</strong> — the OS window picker will open.
                          <span style={{ display: 'block', marginTop: 8, color: '#555', fontSize: 11 }}>Tip: install the BeeHive desktop app for automatic window detection.</span>
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        style={{ flex: 1, background: presentStep === 'opening' ? '#333' : '#f5a623', color: presentStep === 'opening' ? '#666' : '#000', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 600, cursor: presentStep === 'opening' ? 'not-allowed' : 'pointer', fontFamily: "'Roboto', sans-serif" }}
                        disabled={presentStep === 'opening'}
                        onClick={openAndShare}
                      >
                        {presentStep === 'opening' ? 'Opening…' : window.electronAPI ? `Open in ${presentationApp(pendingFile.name)}` : 'Share Window'}
                      </button>
                      <button
                        style={{ background: '#1a1a1a', color: '#888', border: '1px solid #2a2a2a', borderRadius: 10, padding: '11px 14px', fontSize: 13, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
                        title="Send as download link instead"
                        onClick={() => setFileMode('share')}
                      >
                        Send link
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : (
              /* ── SHARE mode ── */
              <>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 10 }}>
                  <span style={{ color: '#888', fontSize: 11, fontWeight: 300, letterSpacing: 1, textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif" }}>Send to</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="radio" checked={fileRecipients === 'all'} onChange={() => setFileRecipients('all')} style={{ accentColor: '#f5a623' }} />
                    <span style={{ color: '#ddd', fontSize: 13, fontFamily: "'Roboto', sans-serif" }}>All participants</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                    <input type="radio" checked={fileRecipients !== 'all'} onChange={() => setFileRecipients([])} style={{ accentColor: '#f5a623' }} />
                    <span style={{ color: '#ddd', fontSize: 13, fontFamily: "'Roboto', sans-serif" }}>Select participants</span>
                  </label>
                  {fileRecipients !== 'all' && (
                    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6, marginLeft: 26, maxHeight: 160, overflowY: 'auto' as const }}>
                      {participants.filter(p => p.is_active && p.display_name !== displayName).map(p => {
                        const selected = (fileRecipients as string[]).includes(p.display_name)
                        return (
                          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selected}
                              style={{ accentColor: '#5b5ef4' }}
                              onChange={() => {
                                setFileRecipients(prev => {
                                  if (prev === 'all') return [p.display_name]
                                  return selected ? (prev as string[]).filter(n => n !== p.display_name) : [...(prev as string[]), p.display_name]
                                })
                              }}
                            />
                            <span style={{ color: '#ccc', fontSize: 13, fontFamily: "'Roboto', sans-serif" }}>{p.display_name}</span>
                          </label>
                        )
                      })}
                      {participants.filter(p => p.is_active && p.display_name !== displayName).length === 0 && (
                        <span style={{ color: '#555', fontSize: 12 }}>No other participants</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  style={{ background: fileUploading ? '#333' : '#f5a623', color: fileUploading ? '#666' : '#000', border: 'none', borderRadius: 10, padding: '11px 0', fontSize: 13, fontWeight: 600, cursor: fileUploading ? 'not-allowed' : 'pointer', fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5 }}
                  disabled={fileUploading || (fileRecipients !== 'all' && (fileRecipients as string[]).length === 0)}
                  onClick={handleFileShare}
                >
                  {fileUploading ? 'Uploading…' : 'Send File'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Electron window picker */}
      {showWindowPicker && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 28, width: '90vw', maxWidth: 960, maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div>
                <span style={{ color: '#fff', fontSize: 15, fontWeight: 400, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5 }}>Select Window to Share</span>
                <p style={{ color: '#555', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: '4px 0 0' }}>
                  Click a window to preview it before sharing with attendees
                </p>
              </div>
              <button style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex', flexShrink: 0 }} onClick={() => setShowWindowPicker(false)}>
                <X size={20} />
              </button>
            </div>

            {/* Scrollable grid — 2 columns, tall cards */}
            <div style={{ overflowY: 'auto', flex: 1, paddingRight: 6 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
                {desktopSources.map(src => (
                  <button
                    key={src.id}
                    onClick={() => {
                      setShowWindowPicker(false)
                      setPendingSource({ id: src.id, name: src.name, thumbnail: src.thumbnail })
                    }}
                    style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' as const, transition: 'border-color 0.15s', textAlign: 'left' as const }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = '#f5a623')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = '#2a2a2a')}
                  >
                    <img
                      src={src.thumbnail}
                      alt={src.name}
                      style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', background: '#111' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px' }}>
                      {src.appIcon && <img src={src.appIcon} alt="" style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0 }} />}
                      <span style={{ color: '#ccc', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{src.name}</span>
                    </div>
                  </button>
                ))}
                {desktopSources.length === 0 && (
                  <div style={{ gridColumn: '1/-1', color: '#555', fontSize: 13, textAlign: 'center' as const, padding: 48 }}>
                    No windows found. Make sure your presentation is open.
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <button
              style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 10, color: '#666', padding: '10px 0', fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif", flexShrink: 0 }}
              onClick={async () => {
                const sources = await window.electronAPI!.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
                setDesktopSources(sources)
              }}
            >
              Refresh
            </button>
          </div>
        </div>
      )}
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
// BACKGROUND EFFECTS MENU
// ============================================================
function BackgroundMenu({ effect, presetId, flip, blurLevel, uploadedImageName, onEffect, onPreset, onFlip, onBlur, onImageUpload, onClose }: {
  effect: 'none' | 'blur' | 'image' | 'virtual'
  presetId: string
  flip: boolean
  blurLevel: number
  uploadedImageName: string
  onEffect: (e: 'none' | 'blur' | 'image' | 'virtual') => void
  onPreset: (id: string) => void
  onFlip: () => void
  onBlur: (v: number) => void
  onImageUpload: (file: File) => void
  onClose: () => void
}) {
  const tabs = [
    { key: 'none',    label: 'None' },
    { key: 'blur',    label: 'Blur' },
    { key: 'image',   label: 'Image' },
    { key: 'virtual', label: 'Virtual' },
  ] as const

  return (
    <div style={s.bgMenu}>
      <div style={s.shareMenuHeader}>
        <span style={s.shareMenuTitle}>Background</span>
        <button style={s.shareMenuClose} onClick={onClose}><X size={14} /></button>
      </div>

      {/* Mode tabs */}
      <div style={s.bgTabs}>
        {tabs.map(t => (
          <button
            key={t.key}
            style={{ ...s.bgTab, ...(effect === t.key ? s.bgTabActive : {}) }}
            onClick={() => onEffect(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Blur — background only, person stays sharp */}
      {effect === 'blur' && (
        <div style={s.bgSection}>
          <p style={s.bgHint}>Blurs the background behind you.</p>
          <div style={s.bgRow}>
            <span style={s.bgLabel}>Intensity</span>
            <input
              type="range" min={2} max={20} value={blurLevel}
              onChange={e => onBlur(Number(e.target.value))}
              style={s.bgSlider}
            />
            <span style={{ ...s.bgLabel, minWidth: 20, textAlign: 'right' as const }}>{blurLevel}</span>
          </div>
          <div style={s.bgRow}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={onFlip}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}

      {/* Image — upload a photo as background */}
      {effect === 'image' && (
        <div style={s.bgSection}>
          <label style={{ cursor: 'pointer' }}>
            <input
              type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) onImageUpload(f) }}
            />
            <div style={s.bgUploadBtn}>
              <Upload size={14} color="#aaa" />
              <span style={{ color: '#aaa', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300 }}>
                {uploadedImageName ? 'Change image' : 'Upload image'}
              </span>
            </div>
          </label>
          {uploadedImageName && (
            <div style={s.bgUploadedName}>{uploadedImageName}</div>
          )}
          {!uploadedImageName && (
            <p style={s.bgHint}>Your photo replaces the background behind you.</p>
          )}
          <div style={s.bgRow}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={onFlip}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}

      {/* Virtual — preset scenes */}
      {effect === 'virtual' && (
        <div style={s.bgSection}>
          <div style={s.bgPresetGrid}>
            {VIRTUAL_PRESETS.map(p => (
              <button
                key={p.id}
                title={p.label}
                style={{
                  ...s.bgPresetBtn,
                  background: `linear-gradient(135deg, ${p.preview.join(', ')})`,
                  ...(presetId === p.id ? s.bgPresetActive : {}),
                }}
                onClick={() => onPreset(p.id)}
              >
                <span style={s.bgPresetLabel}>{p.label}</span>
              </button>
            ))}
          </div>
          <div style={s.bgRow}>
            <FlipHorizontal size={13} color="#888" />
            <span style={s.bgLabel}>Flip</span>
            <button style={{ ...s.bgToggle, ...(flip ? s.bgToggleOn : {}) }} onClick={onFlip}>
              {flip ? 'On' : 'Off'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// AUTO CAM WINDOW
// ============================================================
function AutoCamWindow({ mode, onModeChange, onClose }: {
  mode: 'center' | 'split'
  onModeChange: (m: 'center' | 'split') => void
  onClose: () => void
}) {
  const participants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()

  // Track the active speaker with a debounce so the window doesn't flicker
  const [activeSpeakerId, setActiveSpeakerId] = useState<string>(localParticipant.identity)
  const speakerLockRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const tick = setInterval(() => {
      const loudest = participants
        .filter(p => p.isSpeaking && p.audioLevel > 0.02)
        .sort((a, b) => b.audioLevel - a.audioLevel)[0]
      if (loudest && loudest.identity !== activeSpeakerId) {
        if (speakerLockRef.current) clearTimeout(speakerLockRef.current)
        speakerLockRef.current = setTimeout(() => {
          setActiveSpeakerId(loudest.identity)
          speakerLockRef.current = null
        }, 1500) // wait 1.5s before switching to prevent rapid churn
      }
    }, 200)
    return () => {
      clearInterval(tick)
      if (speakerLockRef.current) clearTimeout(speakerLockRef.current)
    }
  }, [participants, activeSpeakerId])

  const focusTrack = cameraTracks.find(t => t.participant.identity === activeSpeakerId)
  const localTrack = cameraTracks.find(t => t.participant.identity === localParticipant.identity)
  const focusName = participants.find(p => p.identity === activeSpeakerId)?.name?.split(' ')[0]
    || activeSpeakerId.split(' ')[0]
  const isLocalFocus = activeSpeakerId === localParticipant.identity

  return (
    <div style={{ ...s.autoCamWindow, width: mode === 'split' ? 360 : 240 }}>
      {/* Header */}
      <div style={s.autoCamHeader}>
        <div style={s.autoCamTabs}>
          <button
            style={{ ...s.autoCamTab, ...(mode === 'center' ? s.autoCamTabActive : {}) }}
            onClick={() => onModeChange('center')}
          >
            <Crosshair size={11} /> Centre
          </button>
          <button
            style={{ ...s.autoCamTab, ...(mode === 'split' ? s.autoCamTabActive : {}) }}
            onClick={() => onModeChange('split')}
          >
            <Users size={11} /> 2 in 1
          </button>
        </div>
        <button style={s.autoCamClose} onClick={onClose}><X size={12} /></button>
      </div>

      {/* Auto Centre — single speaker, top-biased crop */}
      {mode === 'center' && (
        <div style={s.autoCamVideoWrap}>
          {focusTrack ? (
            <div style={s.autoCamCropFrame}>
              <ParticipantTile trackRef={focusTrack} style={{ width: '100%', height: '100%' }} />
            </div>
          ) : (
            <div style={s.autoCamNoVideo}><VideoOff size={22} color="#444" /></div>
          )}
          <div style={s.autoCamNameTag}>
            <Crosshair size={10} color="#4299e1" />
            {isLocalFocus ? 'You' : focusName}
          </div>
        </div>
      )}

      {/* 2 in 1 — local + active speaker side by side */}
      {mode === 'split' && (
        <div style={s.autoCamSplitRow}>
          {/* Local */}
          <div style={s.autoCamHalf}>
            {localTrack ? (
              <ParticipantTile trackRef={localTrack} style={{ width: '100%', height: '100%' }} />
            ) : (
              <div style={s.autoCamNoVideo}><VideoOff size={16} color="#444" /></div>
            )}
            <div style={s.autoCamSplitLabel}>You</div>
          </div>
          <div style={s.autoCamDivider} />
          {/* Active speaker */}
          <div style={s.autoCamHalf}>
            {focusTrack && !isLocalFocus ? (
              <ParticipantTile trackRef={focusTrack} style={{ width: '100%', height: '100%' }} />
            ) : (
              <div style={s.autoCamNoVideo}><VideoOff size={16} color="#444" /></div>
            )}
            <div style={s.autoCamSplitLabel}>{isLocalFocus ? 'Waiting…' : focusName}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// SPEAKING INDICATOR + SPEAKER VIDEO WINDOW
// ============================================================
function SpeakingIndicator({ overlayMode = 'visible' }: { overlayMode?: 'visible' | 'minimized' | 'hidden' }) {
  const participants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const [speakers, setSpeakers] = useState<Array<{ identity: string; name: string; level: number }>>([])
  const [minimized, setMinimized] = useState(false)
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const tick = setInterval(() => {
      const active = participants
        .filter(p => p.isSpeaking && p.audioLevel > 0.015)
        .map(p => ({ identity: p.identity, name: (p.name || p.identity).split(' ')[0], level: Math.min(p.audioLevel * 2.5, 1) }))

      if (active.length > 0) {
        if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
        setSpeakers(active)
      } else if (!hideTimerRef.current) {
        hideTimerRef.current = setTimeout(() => {
          setSpeakers([])
          hideTimerRef.current = null
        }, 600)
      }
    }, 80)

    return () => {
      clearInterval(tick)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [participants])

  // When the primary speaker changes to a different person, reset dismissed state
  useEffect(() => {
    if (speakers.length > 0 && dismissedId && speakers[0].identity !== dismissedId) {
      setDismissedId(null)
    }
  }, [speakers, dismissedId])

  if (speakers.length === 0 || overlayMode === 'hidden') return null

  const activeSpeaker = speakers[0]
  const camTrack = cameraTracks.find(t => t.participant.identity === activeSpeaker.identity)
  const showWindow = !minimized && dismissedId !== activeSpeaker.identity && overlayMode !== 'minimized'
  const BAR_SHAPE = [0.35, 0.65, 1.0, 0.65, 0.35]

  return (
    <div style={s.speakingWrap}>
      {/* Floating speaker video window */}
      {showWindow && (
        <div style={s.speakerWindow}>
          <div style={s.speakerWindowHeader}>
            <span style={s.speakerWindowName}>{activeSpeaker.name}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={s.speakerWindowBtn} title="Minimise" onClick={() => setMinimized(true)}>—</button>
              <button style={s.speakerWindowBtn} title="Close" onClick={() => setDismissedId(activeSpeaker.identity)}>
                <X size={11} />
              </button>
            </div>
          </div>
          <div style={s.speakerVideoArea}>
            {camTrack ? (
              <ParticipantTile trackRef={camTrack} style={{ width: '100%', height: '100%', borderRadius: '0 0 10px 10px' }} />
            ) : (
              <div style={s.speakerNoVideo}><VideoOff size={20} color="#444" /></div>
            )}
          </div>
        </div>
      )}

      {/* Sound bar chip — always visible while speaking */}
      <div style={s.speakingChip}>
        {minimized && (
          <button style={s.speakerRestoreBtn} title="Show video" onClick={() => setMinimized(false)}>
            <Video size={11} />
          </button>
        )}
        <div style={s.soundBars}>
          {BAR_SHAPE.map((mult, j) => (
            <div
              key={j}
              style={{
                ...s.soundBar,
                transform: `scaleY(${Math.max(0.15, activeSpeaker.level * mult)})`,
              }}
            />
          ))}
        </div>
        <span style={s.speakingName}>{activeSpeaker.name}</span>
        {speakers.length > 1 && (
          <span style={s.speakingExtra}>+{speakers.length - 1}</span>
        )}
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
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#111', borderBottom: '1px solid #222', zIndex: 10, WebkitAppRegion: 'drag' as any, minHeight: 52 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag' as any },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8, WebkitAppRegion: 'no-drag' as any },
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
  sendBtn: { background: '#5b5ef4', color: '#fff', border: 'none', borderRadius: 8, width: 38, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  fileCard: { display: 'flex', flexDirection: 'column' as const, gap: 4, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '10px 12px' },
  fileCardLink: { display: 'flex', alignItems: 'center', gap: 8, color: '#ddd', textDecoration: 'none', fontSize: 13, background: '#111', border: '1px solid #222', borderRadius: 8, padding: '8px 10px', marginTop: 4 },
  recordings: { padding: '12px 14px', borderTop: '1px solid #1e1e1e' },
  recLink: { display: 'block', color: '#5b5ef4', fontSize: 13, textDecoration: 'none', marginBottom: 4 },

  // Lobby tab switcher (Start Now / Schedule)
  lobbyTabRow: { display: 'flex', gap: 4, background: '#111', border: '1px solid #1e1e1e', borderRadius: 10, padding: 4 },
  lobbyTab: { flex: 1, background: 'transparent', border: 'none', borderRadius: 7, color: '#555', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", cursor: 'pointer', padding: '7px 0', letterSpacing: 0.5, transition: 'all 0.15s' },
  lobbyTabActive: { background: '#1e1e1e', color: '#f5a623', border: '1px solid #2a2a2a' },

  // Fathom toggle button (lobby)
  fathomToggleBtn: { display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: '1px solid #222', borderRadius: 10, padding: '8px 16px', color: '#555', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", cursor: 'pointer', width: 360, letterSpacing: 0.5 },

  // Fathom panel
  fathomPanel: { width: 360, background: '#111', border: '1px solid #1e1e1e', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' as const },
  fathomHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #1e1e1e' },
  fathomHeaderTitle: { color: '#f5a623', fontSize: 10, fontWeight: 400, fontFamily: "'Roboto', sans-serif", letterSpacing: 2 },
  fathomLink: { color: '#5b5ef4', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", textDecoration: 'none' },
  fathomEmpty: { color: '#444', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", padding: '20px 16px', textAlign: 'center' as const },
  fathomList: { display: 'flex', flexDirection: 'column' as const, maxHeight: 420, overflowY: 'auto' as const },
  fathomLoadMore: { background: 'none', border: 'none', borderTop: '1px solid #1e1e1e', color: '#555', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", padding: '10px', cursor: 'pointer', width: '100%' },
  fathomRetryBtn: { background: 'none', border: '1px solid #333', borderRadius: 8, color: '#666', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", padding: '5px 16px', cursor: 'pointer' },

  // Fathom meeting row
  fathomRow: { borderBottom: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column' as const },
  fathomRowHeader: { background: 'none', border: 'none', cursor: 'pointer', padding: '12px 16px', textAlign: 'left' as const, display: 'flex', flexDirection: 'column' as const, gap: 3 },
  fathomRowMeta: { display: 'flex', alignItems: 'center', gap: 8 },
  fathomRowDate: { color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300 },
  fathomRowDuration: { color: '#3a3a3a', fontSize: 10, fontFamily: "'Roboto', sans-serif", fontWeight: 300, background: '#1e1e1e', borderRadius: 4, padding: '1px 5px' },
  fathomRowTitle: { color: '#ccc', fontSize: 13, fontFamily: "'Roboto', sans-serif", fontWeight: 300 },
  fathomRowRecordedBy: { color: '#3a3a3a', fontSize: 10, fontFamily: "'Roboto', sans-serif" },
  fathomChip: { color: '#333', fontSize: 10 },

  // Fathom expanded detail
  fathomDetail: { padding: '0 16px 14px', display: 'flex', flexDirection: 'column' as const, gap: 12 },
  fathomSection: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  fathomSectionTitle: { color: '#444', fontSize: 9, fontWeight: 400, fontFamily: "'Roboto', sans-serif", letterSpacing: 1.5, textTransform: 'uppercase' as const },
  fathomSummaryText: { color: '#888', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const, maxHeight: 160, overflowY: 'auto' as const },
  fathomActionItem: { display: 'flex', alignItems: 'flex-start', gap: 8 },
  fathomAssignee: { color: '#3a3a3a', fontSize: 11, fontFamily: "'Roboto', sans-serif", flexShrink: 0 },

  // Transcript
  fathomTranscriptToggle: { background: 'none', border: '1px solid #222', borderRadius: 6, color: '#444', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300, padding: '5px 10px', cursor: 'pointer', alignSelf: 'flex-start' as const },
  fathomTranscript: { display: 'flex', flexDirection: 'column' as const, gap: 6, maxHeight: 240, overflowY: 'auto' as const, background: '#0d0d0d', borderRadius: 8, padding: '10px 12px' },
  fathomTranscriptLine: { display: 'flex', gap: 8, alignItems: 'flex-start' },
  fathomTranscriptTime: { color: '#333', fontSize: 10, fontFamily: 'monospace', flexShrink: 0, marginTop: 2 },
  fathomTranscriptSpeaker: { color: '#5b5ef4', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 400, flexShrink: 0, minWidth: 80 },
  fathomTranscriptText: { color: '#777', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, lineHeight: 1.5 },

  // Background effects menu
  bgMenu: { position: 'absolute' as const, bottom: 62, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '10px', width: 280, display: 'flex', flexDirection: 'column' as const, gap: 8, zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.7)' },
  bgTabs: { display: 'flex', gap: 4 },
  bgTab: { flex: 1, background: 'none', border: '1px solid #2a2a2a', borderRadius: 8, padding: '5px 0', color: '#666', fontSize: 11, fontFamily: "'Roboto', sans-serif", cursor: 'pointer' },
  bgTabActive: { background: '#2a2010', borderColor: '#f5a623', color: '#f5a623' },
  bgSection: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  bgRow: { display: 'flex', alignItems: 'center', gap: 8 },
  bgLabel: { color: '#888', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300, flex: 1 },
  bgSlider: { flex: 1, accentColor: '#f5a623', cursor: 'pointer' },
  bgToggle: { background: '#222', border: '1px solid #333', borderRadius: 20, padding: '3px 12px', color: '#666', fontSize: 11, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" },
  bgToggleOn: { background: '#2a2010', borderColor: '#f5a623', color: '#f5a623' },
  bgHint: { color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: 0 },
  bgPresetGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 },
  bgPresetBtn: { height: 52, borderRadius: 8, border: '2px solid transparent', cursor: 'pointer', position: 'relative' as const, overflow: 'hidden', padding: 0 },
  bgPresetActive: { border: '2px solid #f5a623', boxShadow: '0 0 0 1px rgba(245,166,35,0.4)' },
  bgPresetLabel: { position: 'absolute' as const, bottom: 3, left: 0, right: 0, textAlign: 'center' as const, color: 'rgba(255,255,255,0.9)', fontSize: 9, fontFamily: "'Roboto', sans-serif", fontWeight: 400, textShadow: '0 1px 3px rgba(0,0,0,0.8)', letterSpacing: 0.3 },
  bgUploadBtn: { display: 'flex', alignItems: 'center', gap: 8, background: '#222', border: '1px dashed #444', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', transition: 'border-color 0.15s' },
  bgUploadedName: { color: '#48bb78', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },

  // Auto cam window (bottom-right of video area)
  autoCamMenu: { position: 'absolute' as const, bottom: 62, left: '50%', transform: 'translateX(-50%)', background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '10px', minWidth: 200, display: 'flex', flexDirection: 'column' as const, gap: 4, zIndex: 50, boxShadow: '0 8px 32px rgba(0,0,0,0.7)' },
  autoCamWindow: { position: 'absolute' as const, bottom: 20, right: 20, background: '#141414', border: '1px solid #1e3a5a', borderRadius: 12, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.7)', zIndex: 15 },
  autoCamHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', background: '#1a1a1a', borderBottom: '1px solid #222' },
  autoCamTabs: { display: 'flex', gap: 4 },
  autoCamTab: { display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: '1px solid #333', borderRadius: 20, padding: '3px 10px', color: '#666', fontSize: 11, fontFamily: "'Roboto', sans-serif", cursor: 'pointer' },
  autoCamTabActive: { background: '#1a2e4a', borderColor: '#4299e1', color: '#4299e1' },
  autoCamClose: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 2 },
  autoCamVideoWrap: { position: 'relative' as const, width: '100%', aspectRatio: '4/3', background: '#0d0d0d', overflow: 'hidden' },
  autoCamCropFrame: { width: '100%', height: '100%', overflow: 'hidden' },
  autoCamNoVideo: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d' },
  autoCamNameTag: { position: 'absolute' as const, bottom: 8, left: 10, display: 'flex', alignItems: 'center', gap: 5, color: '#d0d0d0', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", background: 'rgba(0,0,0,0.6)', borderRadius: 10, padding: '3px 8px' },
  autoCamSplitRow: { display: 'flex', height: 135, background: '#0d0d0d' },
  autoCamHalf: { flex: 1, position: 'relative' as const, overflow: 'hidden' },
  autoCamDivider: { width: 1, background: '#222', flexShrink: 0 },
  autoCamSplitLabel: { position: 'absolute' as const, bottom: 5, left: 6, color: '#bbb', fontSize: 10, fontWeight: 300, fontFamily: "'Roboto', sans-serif", background: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: '2px 6px' },

  // Speaking indicator + speaker window
  speakingWrap: { position: 'absolute' as const, bottom: 20, left: 20, display: 'flex', flexDirection: 'column' as const, gap: 6, zIndex: 15 },
  speakerWindow: { width: 220, background: '#141414', border: '1px solid rgba(72,187,120,0.25)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.7)' },
  speakerWindowHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 8px 7px 12px', background: '#1a1a1a', borderBottom: '1px solid #222' },
  speakerWindowName: { color: '#d0d0d0', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  speakerWindowBtn: { background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: 4, fontSize: 13, lineHeight: 1 },
  speakerVideoArea: { width: '100%', aspectRatio: '16/9', background: '#0d0d0d', position: 'relative' as const },
  speakerNoVideo: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  speakingChip: { display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(10px)', borderRadius: 20, padding: '6px 14px 6px 10px', border: '1px solid rgba(72,187,120,0.2)', pointerEvents: 'auto' as const },
  speakerRestoreBtn: { background: 'none', border: 'none', color: '#48bb78', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '0 2px' },
  soundBars: { display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 },
  soundBar: { width: 3, height: 18, borderRadius: 2, background: '#48bb78', transformOrigin: '50% 100%', transition: 'transform 0.08s ease' },
  speakingName: { color: '#d0d0d0', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.3 },
  speakingExtra: { color: '#666', fontSize: 11, fontFamily: "'Roboto', sans-serif" },

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
