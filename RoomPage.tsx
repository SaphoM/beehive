import { useState, useEffect, useRef, useCallback } from 'react'
import { PhoneOff, Link, Link2Off, Film, Hand, MessageSquare, Mic, MicOff, Video, VideoOff, X, Monitor, MonitorOff, MonitorX, ArrowLeftRight, CheckSquare, Square, Aperture, Crosshair, Users, Layers, FlipHorizontal, Upload } from 'lucide-react'
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

  // Auto cam state
  const [autoCamMode, setAutoCamMode] = useState<'center' | 'split' | null>(null)
  const [showAutoCamMenu, setShowAutoCamMenu] = useState(false)

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

          {/* Auto Cam Window */}
          {autoCamMode && (
            <AutoCamWindow
              mode={autoCamMode}
              onModeChange={setAutoCamMode}
              onClose={() => { setAutoCamMode(null); setShowAutoCamMenu(false) }}
            />
          )}

          {/* Speaking Indicator */}
          <SpeakingIndicator />

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
function SpeakingIndicator() {
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

  if (speakers.length === 0) return null

  const activeSpeaker = speakers[0]
  const camTrack = cameraTracks.find(t => t.participant.identity === activeSpeaker.identity)
  const showWindow = !minimized && dismissedId !== activeSpeaker.identity
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
