import React, { useState, useEffect, useRef, useCallback } from 'react'

declare global {
  interface Window {
    electronAPI?: {
      isElectron: true
      getFilePath: (file: File) => string
      openFile: (filePath: string) => Promise<string | null>
      getDesktopSources: (opts?: { types?: string[]; thumbnailSize?: { width: number; height: number } }) => Promise<Array<{ id: string; name: string; thumbnail: string; appIcon: string | null; display_id: string }>>
      getScreenAccessStatus: () => Promise<'granted' | 'denied' | 'restricted' | 'not-determined'>
      stopFloating: () => void
      requestMediaPermissions: () => Promise<{ camera: string; mic: string }>
      presentationControl: (direction: 'next' | 'prev') => Promise<boolean>
      toggleFullscreen: () => Promise<boolean>
      getFullscreen: () => Promise<boolean>
      onFullscreenChange: (cb: (v: boolean) => void) => () => void
      control?: {
        begin: (title: string) => Promise<{ ok: boolean; reason?: string; message?: string; title?: string; titles?: string[]; region?: { left: number; top: number; width: number; height: number } }>
        refresh: () => Promise<{ ok: boolean }>
        end: () => Promise<{ ok: boolean }>
        move: (nx: number, ny: number) => Promise<void>
        click: (nx: number, ny: number, opts?: { button?: 'left' | 'right' | 'middle'; double?: boolean }) => Promise<void>
        scroll: (nx: number, ny: number, dx: number, dy: number) => Promise<void>
        type: (text: string) => Promise<void>
        key: (key: string, modifiers?: string[]) => Promise<void>
        accessibility: (prompt: boolean) => Promise<boolean>
      }
    }
  }
}
declare global { interface File { path?: string } }

import { PhoneOff, Link, Film, Hand, MessageSquare, X, Monitor, MonitorOff, Aperture, Crosshair, Users, Layers, Paperclip, Download, EyeOff, Minus, Maximize2, Minimize2, ExternalLink, ChevronLeft, ChevronRight, Smile, Volume2, VolumeX, MousePointer2 } from 'lucide-react'
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
  useAuth,
  useProfile,
  supabase,
} from './livekit_react_hooks'

import { Lobby } from './components/Lobby'
import { InviteModal } from './components/InviteModal'
import { ParticipantsWindow, DockedParticipantsStrip } from './components/ParticipantsWindow'
import { BackgroundMenu } from './components/BackgroundMenu'
import { AutoCamWindow } from './components/AutoCamWindow'
import { SpeakingIndicator } from './components/SpeakingIndicator'
import { ScreenShareMenu } from './components/ScreenShareMenu'
import { ScreenShareBar } from './components/ScreenShareBar'
import { ElectronWindowPicker } from './components/ElectronWindowPicker'
import { ReactionComposer } from './components/ReactionComposer'
import { s } from './components/roomStyles'
import {
  APP_NAME,
  REACTIONS,
  QUALITY_OPTIONS,
  isPresentationFile,
  presentationApp,
  formatBytes,
  getReactionTemplate,
  fileIcon,
  ensureMediaPipe,
  drawVirtualScene,
  type Subtext,
} from './components/roomUtils'

export default function RoomPage() {
  const { user } = useAuth()
  const { profile } = useProfile(user?.id ?? null)

  const [view, setView] = useState<'lobby' | 'room'>('lobby')
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [livekitRoomName, setLivekitRoomName] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState<string | null>(null)
  const [subtext, setSubtext] = useState<Subtext>('Meet')
  const [showProfileSetup, setShowProfileSetup] = useState(false)

  // Derive display name from auth profile or email prefix
  useEffect(() => {
    if (displayName) return  // user has typed something, leave it
    if (profile?.full_name) {
      setDisplayName(profile.full_name)
    } else if (user?.email) {
      setDisplayName(user.email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))
    }
  }, [profile?.full_name, user?.email])

  const { createRoom, loading: creating } = useCreateRoom()
  const { joinRoom, loading: joining } = useJoinRoom()
  const { room: inviteRoom } = useRoomInfo(joinRoomId)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('room')
    if (roomId) setJoinRoomId(roomId)
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.requestMediaPermissions) return
    window.electronAPI.requestMediaPermissions().catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!displayName.trim()) return alert('Enter your name first')
    const room = await createRoom(`Meeting ${new Date().toLocaleTimeString()}`, 'X Spark')
    if (!room) return alert('Failed to create room')
    const result = await joinRoom(room.id, displayName)
    if (!result) return alert('Failed to get access token')
    window.history.pushState({}, '', `?room=${room.id}`)
    setActiveRoomId(room.id)
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
    setLivekitRoomName(result.livekitRoomName)
    setToken(result.token)
    setView('room')
  }

  const handleLeave = () => {
    window.history.pushState({}, '', '/')
    setView('lobby')
    setActiveRoomId(null)
    setLivekitRoomName(null)
    setToken(null)
    // Prompt unauthenticated users (frictionless room join) to register after the meeting
    if (!user) setShowProfileSetup(true)
  }

  if (view === 'room' && token && activeRoomId && livekitRoomName) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={true}
        onDisconnected={handleLeave}
        style={{ height: 'var(--vh, 100vh)' }}
      >
        <MeetingRoom
          roomId={activeRoomId}
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
      user={user}
      showRegister={showProfileSetup}
      onDismissRegister={() => setShowProfileSetup(false)}
    />
  )
}

// ============================================================
// MEETING ROOM
// ============================================================
function MeetingRoom({ roomId, displayName, onLeave }: {
  roomId: string; displayName: string; onLeave: () => void
}) {
  const [showInviteModal, setShowInviteModal] = useState(false)
  const allTracks = useTracks([Track.Source.Camera, Track.Source.ScreenShare], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()
  const liveKitParticipants = useLiveKitParticipants()

  const tracks = allTracks.filter(t =>
    !(t.participant.identity === localParticipant.identity && t.source === Track.Source.ScreenShare)
  )
  const remoteScreenTracks = allTracks.filter(t =>
    t.source === Track.Source.ScreenShare &&
    t.participant.identity !== localParticipant.identity
  )
  const hasRemoteScreenShare = remoteScreenTracks.length > 0
  const cameraTracksRaw = tracks.filter(t => t.source !== Track.Source.ScreenShare)

  // useTracks with onlySubscribed:false can return both placeholder and real track for
  // the same participant when camera first enables — deduplicate, keeping the published track
  const cameraTracks = (() => {
    const byKey = new Map<string, typeof cameraTracksRaw[0]>()
    for (const t of cameraTracksRaw) {
      const key = `${t.participant.identity}-${t.source}`
      const existing = byKey.get(key)
      if (!existing || t.publication) byKey.set(key, t)
    }
    return [...byKey.values()]
  })()

  const participants = useParticipants(roomId)
  const { messages, sendMessage } = useChat(roomId)
  const recordings = useRecordings(roomId)
  const [chatInput, setChatInput] = useState('')
  const [showChat, setShowChat] = useState(() => window.innerWidth > 768)
  const [showParticipants, setShowParticipants] = useState(false)
  const [participantsDocked, setParticipantsDocked] = useState(false)
  const [showQuality, setShowQuality] = useState(false)
  const [quality, setQuality] = useState('Medium (720p)')
  const [floatingReactions, setFloatingReactions] = useState<{
    id: number; emoji: string; message?: string; senderName?: string; x: number
  }[]>([])
  const [reactionComposer, setReactionComposer] = useState<{
    emoji: string; text: string; anchor: { x: number; y: number; width: number }
  } | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const reactionId = useRef(0)
  const reactionChannelRef = useRef<any>(null)
  const lastReactionAt = useRef(0)
  const emojiLongPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emojiLongPressed = useRef(false)
  const dockRafRef = useRef<number>(0)
  const controlsBarRef = useRef<HTMLDivElement>(null)
  const REACTION_COOLDOWN_MS = 5000

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
  const [detectingWindow, setDetectingWindow] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [presentQueue, setPresentQueue] = useState<File[]>([])
  const queueInputRef = useRef<HTMLInputElement>(null)

  // Mobile responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  const [isSmallPhone, setIsSmallPhone] = useState(() => window.innerWidth <= 430)
  const [showMobileEmoji, setShowMobileEmoji] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  const [speakerMuted, setSpeakerMuted] = useState(false)

  // Direct messages — open DM cards keyed by participant name
  const [openDms, setOpenDms] = useState<Set<string>>(new Set())
  const [expandedDms, setExpandedDms] = useState<Set<string>>(new Set())
  const [dmInputs, setDmInputs] = useState<Record<string, string>>({})
  const [dmUnread, setDmUnread] = useState<Set<string>>(new Set())

  const openDm = (name: string) => {
    setOpenDms(prev => new Set([...prev, name]))
    setExpandedDms(prev => new Set([...prev, name]))
    setDmUnread(prev => { const n = new Set(prev); n.delete(name); return n })
  }
  const closeDm = (name: string) => {
    setOpenDms(prev => { const n = new Set(prev); n.delete(name); return n })
    setExpandedDms(prev => { const n = new Set(prev); n.delete(name); return n })
  }
  const toggleDm = (name: string) => {
    setExpandedDms(prev => {
      const n = new Set(prev)
      if (n.has(name)) { n.delete(name) } else { n.add(name); setDmUnread(u => { const nu = new Set(u); nu.delete(name); return nu }) }
      return n
    })
  }
  const sendDm = (to: string) => {
    const text = (dmInputs[to] || '').trim()
    if (!text) return
    sendMessage(`__DM__${JSON.stringify({ from: displayName, to, text })}`, displayName)
    setDmInputs(prev => ({ ...prev, [to]: '' }))
  }

  useEffect(() => {
    const onResize = () => {
      setIsMobile(window.innerWidth <= 640)
      setIsSmallPhone(window.innerWidth <= 430)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Desktop dock magnification — macOS-Dock-accurate, built to be bulletproof:
  //   • Listener is on WINDOW — never stale; bar via React ref (always live DOM).
  //   • Horizontal-only Gaussian distance; vertical proximity gate (V_GATE).
  //   • transform/filter only — no layout properties so pointer events are never
  //     disrupted and the bar never overflows its overflow:hidden parent.
  useEffect(() => {
    if (isMobile) return

    const MAX_SCALE = 1.90 // peak magnification directly under the cursor
    const SIGMA     = 95   // Gaussian width (px) — how far the wave spreads
    const MAX_LIFT  = 12   // px — subtle lift; scale carries the visual weight
    const V_GATE    = 70   // px above/below the bar within which the dock "engages"

    // Spring entry: slight overshoot on first engage → satisfying Dock pop
    const SPRING = 'transform 0.24s cubic-bezier(0.34,1.56,0.64,1), filter 0.24s ease'
    // Tracking: fast ease-out — icons follow the cursor without lag
    const TRACK  = 'transform 0.12s cubic-bezier(0.22,1,0.36,1), filter 0.12s ease'
    // Settle: long spring — icons float back with a micro-bounce landing
    const SETTLE = 'transform 0.55s cubic-bezier(0.34,1.18,0.5,1), filter 0.45s ease'

    let engaged = false

    const W   = 48  // button layout width (px)
    const GAP = 12  // CSS gap between buttons (px)

    // Abramowitz & Stegun erf approximation (max error ±1.5e-7).
    // Used to compute the smooth integral of the gaussian wave, giving each
    // button a continuously-differentiable X-shift so there is no jump when
    // the cursor crosses a button boundary.
    const erf = (x: number): number => {
      const sign = x >= 0 ? 1 : -1
      const a = Math.abs(x)
      const t = 1 / (1 + 0.3275911 * a)
      const p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
      return sign * (1 - p * Math.exp(-a * a))
    }
    const ERF_COEFF = (W / (W + GAP)) * (MAX_SCALE - 1) * SIGMA * Math.sqrt(Math.PI / 2)
    const SIGMA_SQRT2 = SIGMA * Math.SQRT2

    const paint = (mouseX: number, phase: string, atRest: boolean) => {
      const bar = controlsBarRef.current
      if (!bar) return
      const btns = Array.from(bar.querySelectorAll<HTMLElement>('.bhv-btn'))

      if (atRest) {
        btns.forEach(btn => {
          btn.style.transition = phase
          btn.style.transform  = ''
          btn.style.filter     = ''
        })
        return
      }

      // Read the bar's screen position once — bar has no animation so this is stable.
      const barLeft = bar.getBoundingClientRect().left

      btns.forEach(btn => {
        // Walk the offsetParent chain (which only sees layout, never CSS transforms)
        // to get each button's natural centre in viewport coords.  This prevents the
        // feedback loop where a previously applied translateX corrupts the next frame.
        let naturalLeft = btn.offsetWidth / 2
        let el: HTMLElement | null = btn
        while (el && el !== bar) {
          naturalLeft += el.offsetLeft
          el = el.offsetParent as HTMLElement | null
        }
        const cx = barLeft + naturalLeft

        const dx    = mouseX - cx
        const gauss = Math.exp(-(dx * dx) / (2 * SIGMA * SIGMA))
        const scale = 1 + (MAX_SCALE - 1) * gauss
        const lift  = gauss * MAX_LIFT
        // transform-origin:center grows the button symmetrically, pushing it down
        // by (scale-1)*halfHeight. upShift compensates so the visual bottom lifts
        // cleanly off the dock floor without the hit-area drifting.
        const upShift = lift + (scale - 1) * (W / 2)

        // Continuous X-shift: integral of the gaussian from cursor to this button.
        // ∫_{mouseX}^{cx} (MAX_SCALE-1)·exp(-t²/2σ²) dt = ERF_COEFF · erf(dx_signed/σ√2)
        // Positive d = button is right of cursor → shifts right; negative → shifts left.
        const xShift = ERF_COEFF * erf((cx - mouseX) / SIGMA_SQRT2)

        const shadowY     = lift * 0.5
        const shadowBlur  = lift * 1.8
        const shadowAlpha = (0.06 + gauss * 0.28).toFixed(2)
        const brightness  = (1 + gauss * 0.07).toFixed(3)

        btn.style.transition = phase
        btn.style.transform  =
          `translateX(${xShift.toFixed(2)}px) translateY(-${upShift.toFixed(2)}px) scale(${scale.toFixed(4)})`
        btn.style.filter = gauss > 0.01
          ? `brightness(${brightness}) drop-shadow(0 ${shadowY.toFixed(1)}px ${shadowBlur.toFixed(1)}px rgba(0,0,0,${shadowAlpha}))`
          : ''
      })
    }

    const onMove = (e: MouseEvent) => {
      const bar = controlsBarRef.current
      if (!bar) return
      const rect = bar.getBoundingClientRect()
      // Vertical gate: are we close enough (above/below) for the dock to react?
      const near =
        e.clientY >= rect.top - V_GATE &&
        e.clientY <= rect.bottom + V_GATE &&
        e.clientX >= rect.left - SIGMA * 2 &&
        e.clientX <= rect.right + SIGMA * 2

      // Cheap early-out: cursor is away and icons already rest → nothing to do
      if (!near && !engaged) return

      cancelAnimationFrame(dockRafRef.current)
      const x = e.clientX
      dockRafRef.current = requestAnimationFrame(() => {
        if (near) {
          const phase = engaged ? TRACK : SPRING // first engaged frame springs in
          engaged = true
          paint(x, phase, false)
        } else {
          engaged = false
          paint(x, SETTLE, true) // settle gracefully back to the floor
        }
      })
    }

    // Cursor leaves the window entirely → settle back to rest
    const onWindowOut = () => {
      if (!engaged) return
      engaged = false
      cancelAnimationFrame(dockRafRef.current)
      paint(0, SETTLE, true)
    }

    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('blur', onWindowOut)
    document.addEventListener('mouseleave', onWindowOut)

    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('blur', onWindowOut)
      document.removeEventListener('mouseleave', onWindowOut)
      cancelAnimationFrame(dockRafRef.current)
      paint(0, SETTLE, true)
    }
  }, [isMobile])

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

  // Fullscreen — `isFullscreen` drives a CSS overlay that makes the main area
  // cover the ENTIRE app (header, sidebar, participants all hidden behind it).
  // We *also* trigger native OS fullscreen so the window fills the whole monitor.
  // The CSS overlay is the source of truth, so this works even if the native
  // call is unavailable (e.g. Electron main process not yet reloaded).
  const mainAreaRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const goNativeFullscreen = useCallback(async (on: boolean) => {
    // Prefer Electron's true OS fullscreen (removes the title bar / fills monitor)
    if (window.electronAPI?.toggleFullscreen) {
      try {
        const cur = await window.electronAPI.getFullscreen()
        if (cur !== on) await window.electronAPI.toggleFullscreen()
        return
      } catch { /* fall through to web API */ }
    }
    // Web (and Electron without the new IPC): HTML5 Fullscreen API
    try {
      if (on && !document.fullscreenElement) {
        await document.documentElement.requestFullscreen()
      } else if (!on && document.fullscreenElement) {
        await document.exitFullscreen()
      }
    } catch { /* user gesture / unsupported — CSS overlay still applies */ }
  }, [])

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      const next = !prev
      goNativeFullscreen(next)
      return next
    })
  }, [goNativeFullscreen])

  useEffect(() => {
    // Web: keep state in sync when the user presses Esc / F11 / browser button
    const onChange = () => { if (!document.fullscreenElement) setIsFullscreen(false) }
    document.addEventListener('fullscreenchange', onChange)

    // Electron: sync when OS fullscreen is toggled via green button / swipe / Esc
    let cleanup: (() => void) | undefined
    if (window.electronAPI?.onFullscreenChange) {
      cleanup = window.electronAPI.onFullscreenChange(v => setIsFullscreen(v))
    }

    // Esc always exits the CSS overlay, even if native fullscreen wasn't engaged
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false) }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      document.removeEventListener('keydown', onKey)
      cleanup?.()
    }
  }, [])

  // Pop-out — opens the shared presentation in a detached window. The handler
  // and its effect live further down (after the share state they depend on).
  const popOutWinRef = useRef<Window | null>(null)
  const [isPoppedOut, setIsPoppedOut] = useState(false)

  // Laser pointer — broadcast cursor position to all participants via Supabase realtime
  const CURSOR_COLORS = ['#f5a623', '#48bb78', '#4299e1', '#ed64a6', '#9f7aea', '#ed8936']
  const myColor = CURSOR_COLORS[displayName.charCodeAt(0) % CURSOR_COLORS.length]
  const [laserActive, setLaserActive] = useState(false)
  const [remoteCursors, setRemoteCursors] = useState<Map<string, { x: number; y: number; color: string }>>(new Map())
  const cursorChannelRef = useRef<any>(null)
  const lastCursorSend = useRef(0)

  useEffect(() => {
    const channel = supabase.channel(`cursors:${roomId}`, { config: { broadcast: { self: false } } })
    channel.on('broadcast', { event: 'cursor' }, ({ payload }: any) => {
      setRemoteCursors(prev => {
        const next = new Map(prev)
        next.set(payload.name, { x: payload.x, y: payload.y, color: payload.color })
        return next
      })
    })
    channel.on('broadcast', { event: 'cursor-off' }, ({ payload }: any) => {
      setRemoteCursors(prev => { const next = new Map(prev); next.delete(payload.name); return next })
    })
    channel.subscribe()
    cursorChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  const handleMainAreaMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!laserActive || !cursorChannelRef.current) return
    const now = Date.now()
    if (now - lastCursorSend.current < 33) return // ~30fps throttle
    lastCursorSend.current = now
    const rect = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    cursorChannelRef.current.send({ type: 'broadcast', event: 'cursor', payload: { name: displayName, x, y, color: myColor } })
  }, [laserActive, displayName, myColor])

  const handleMainAreaMouseLeave = useCallback(() => {
    if (!laserActive || !cursorChannelRef.current) return
    cursorChannelRef.current.send({ type: 'broadcast', event: 'cursor-off', payload: { name: displayName } })
  }, [laserActive, displayName])

  useEffect(() => {
    if (!laserActive && cursorChannelRef.current) {
      cursorChannelRef.current.send({ type: 'broadcast', event: 'cursor-off', payload: { name: displayName } })
    }
  }, [laserActive, displayName])

  // Raise hand — broadcast to all participants via Supabase realtime
  const [raisedHands, setRaisedHands] = useState<{ identity: string; name: string; raisedAt: number }[]>([])
  const [myHandRaised, setMyHandRaised] = useState(false)
  const handsChannelRef = useRef<any>(null)

  useEffect(() => {
    const channel = supabase.channel(`hands:${roomId}`, { config: { broadcast: { self: false } } })
    channel
      .on('broadcast', { event: 'hand_raised' }, ({ payload }: any) => {
        setRaisedHands(prev => prev.find(h => h.identity === payload.identity) ? prev : [...prev, { identity: payload.identity, name: payload.name, raisedAt: payload.raisedAt }])
      })
      .on('broadcast', { event: 'hand_lowered' }, ({ payload }: any) => {
        setRaisedHands(prev => prev.filter(h => h.identity !== payload.identity))
      })
      .on('broadcast', { event: 'all_hands_lowered' }, () => {
        setRaisedHands([])
        setMyHandRaised(false)
      })
      .subscribe()
    handsChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  // Reactions channel — self:true so the sender sees their own reaction
  useEffect(() => {
    const channel = supabase.channel(`reactions:${roomId}`, { config: { broadcast: { self: true } } })
    channel.on('broadcast', { event: 'reaction' }, ({ payload }: any) => {
      const id = reactionId.current++
      const x = Math.round((Math.random() - 0.5) * 280) // random horizontal drift -140…+140 px
      const ttl = payload.message ? 3500 : 2500
      setFloatingReactions(prev => [...prev, {
        id, emoji: payload.emoji, message: payload.message || undefined,
        senderName: payload.senderName, x,
      }])
      setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), ttl)
    })
    channel.subscribe()
    reactionChannelRef.current = channel
    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  const toggleRaiseHand = () => {
    if (myHandRaised) {
      handsChannelRef.current?.send({ type: 'broadcast', event: 'hand_lowered', payload: { identity: displayName } })
      setRaisedHands(prev => prev.filter(h => h.identity !== displayName))
      setMyHandRaised(false)
    } else {
      const entry = { identity: displayName, name: displayName, raisedAt: Date.now() }
      handsChannelRef.current?.send({ type: 'broadcast', event: 'hand_raised', payload: entry })
      setRaisedHands(prev => [...prev, entry])
      setMyHandRaised(true)
    }
  }

  const dismissHand = (identity: string) => {
    handsChannelRef.current?.send({ type: 'broadcast', event: 'hand_lowered', payload: { identity } })
    setRaisedHands(prev => prev.filter(h => h.identity !== identity))
    if (identity === displayName) setMyHandRaised(false)
  }

  const lowerAllHands = () => {
    handsChannelRef.current?.send({ type: 'broadcast', event: 'all_hands_lowered', payload: {} })
    setRaisedHands([])
    setMyHandRaised(false)
  }

  // Background effects state
  const [bgMenuOpen, setBgMenuOpen] = useState(false)
  const [bgEffect, setBgEffect] = useState<'none' | 'blur' | 'image' | 'virtual'>('none')
  const [bgFlip, setBgFlip] = useState(false)
  const [blurLevel, setBlurLevel] = useState(8)
  const [bgPresetId, setBgPresetId] = useState('studio')
  const bgOrigTrackRef = useRef<MediaStreamTrack | null>(null)
  const bgUploadedImageRef = useRef<HTMLImageElement | null>(null)
  const [bgUploadedImageName, setBgUploadedImageName] = useState('')
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
        ctx.drawImage(video, 0, 0, W, H)
      }

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

  useEffect(() => {
    if (hasRemoteScreenShare) setShowParticipants(true)
  }, [hasRemoteScreenShare])

  const [autoCamMode, setAutoCamMode] = useState<'center' | 'split' | null>(null)
  const [showAutoCamMenu, setShowAutoCamMenu] = useState(false)

  const [shareMenu, setShareMenu] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  // True when sharing the WHOLE screen (vs. a single window). The presenter's own
  // local preview must be suppressed in this mode, otherwise the app window — which
  // is on the captured screen — mirrors itself into infinity (hall-of-mirrors echo).
  const [sharingEntireScreen, setSharingEntireScreen] = useState(false)
  const [localShareStream, setLocalShareStream] = useState<MediaStream | null>(null)
  const [clearBeforeShare, setClearBeforeShare] = useState(false)
  const [shareLabel, setShareLabel] = useState('')
  const [secondaryStream, setSecondaryStream] = useState<MediaStream | null>(null)
  const [activeSlot, setActiveSlot] = useState<'primary' | 'secondary'>('primary')
  const [roomHidden, setRoomHidden] = useState(false)
  const stopShareRef = useRef<() => void>()

  // Interactive control of the shared window from the main-area preview (desktop).
  // Uses Pointer Lock: while controlling, the physical cursor is locked+hidden and
  // we drive a virtual pointer from relative mouse deltas — so warping the shared
  // window's cursor never yanks the OS cursor around / bounces the pointer.
  const [controlMode, setControlMode] = useState(false)
  const [pointerLocked, setPointerLocked] = useState(false)
  const [controlCursor, setControlCursor] = useState({ x: 0.5, y: 0.5 })
  const shareVideoRef = useRef<HTMLVideoElement | null>(null)
  const controlOverlayRef = useRef<HTMLDivElement | null>(null)
  const controlPos = useRef({ x: 0.5, y: 0.5 })
  // The shared window's real OS title (desktopCapturer source name) — used to
  // locate the window for control. The media-track label is generic, so we keep
  // the source name here when a specific window is shared.
  const controlWindowTitleRef = useRef('')
  const canControlShare = !isMobile && !!window.electronAPI?.control && isSharing && !sharingEntireScreen && !!localShareStream

  // The video's content box within the overlay, accounting for object-fit:contain
  // letterbox bars. Used for delta→normalised scaling and the synthetic cursor.
  const shareContentBox = () => {
    const v = shareVideoRef.current
    const overlay = controlOverlayRef.current
    if (!v || !overlay || !v.videoWidth || !v.videoHeight) return null
    const rect = overlay.getBoundingClientRect()
    const scale = Math.min(rect.width / v.videoWidth, rect.height / v.videoHeight)
    const cw = v.videoWidth * scale, ch = v.videoHeight * scale
    return { ox: (rect.width - cw) / 2, oy: (rect.height - ch) / 2, cw, ch }
  }

  const toggleControlMode = useCallback(async () => {
    if (controlMode) {
      setControlMode(false)
      window.electronAPI?.control?.end()
      return
    }
    const res = await window.electronAPI?.control?.begin(controlWindowTitleRef.current || shareLabel)
    if (!res?.ok) {
      if (res?.reason === 'accessibility') {
        alert('To control your shared window from here, enable Accessibility for BeeHive:\n\nSystem Settings → Privacy & Security → Accessibility → enable BeeHive, then try again.')
      } else if (res?.reason === 'window-not-found') {
        const seen = (res as { titles?: string[] }).titles
        const list = seen && seen.length ? `\n\nWindows detected:\n• ${seen.join('\n• ')}` : '\n\n(No windows were detected — Accessibility may still be initialising; try again in a moment.)'
        alert(`Could not match the shared window "${controlWindowTitleRef.current || shareLabel}" to control.${list}`)
      } else {
        alert('Could not start control of the shared window.')
      }
      return
    }
    setControlMode(true)
  }, [controlMode, shareLabel])

  // Drop control mode if sharing stops or the preview goes away.
  useEffect(() => {
    if (controlMode && !canControlShare) {
      setControlMode(false)
      window.electronAPI?.control?.end()
    }
  }, [controlMode, canControlShare])

  // Pointer-lock control loop: relative mouse deltas → virtual pointer → shared
  // window. The cursor is hidden while locked; a synthetic cursor is drawn in the
  // preview. Escape (browser default) or leaving control mode releases the lock.
  useEffect(() => {
    if (!controlMode) return
    const overlay = controlOverlayRef.current
    if (!overlay) return
    const ctl = window.electronAPI?.control
    let raf = 0, pending = false
    const flush = () => { raf = 0; if (pending) { ctl?.move(controlPos.current.x, controlPos.current.y); pending = false } }

    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== overlay) return
      const box = shareContentBox()
      if (!box) return
      const p = controlPos.current
      p.x = Math.min(1, Math.max(0, p.x + e.movementX / box.cw))
      p.y = Math.min(1, Math.max(0, p.y + e.movementY / box.ch))
      setControlCursor({ x: p.x, y: p.y })
      pending = true
      if (!raf) raf = requestAnimationFrame(flush)
    }
    const onDown = (e: MouseEvent) => {
      if (document.pointerLockElement === overlay) {
        e.preventDefault()
        const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
        ctl?.click(controlPos.current.x, controlPos.current.y, { button })
      } else if (e.target === overlay) {
        overlay.requestPointerLock()
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (document.pointerLockElement !== overlay) return
      e.preventDefault()
      ctl?.scroll(controlPos.current.x, controlPos.current.y, e.deltaX, e.deltaY)
    }
    const onCtx = (e: MouseEvent) => { if (document.pointerLockElement === overlay) e.preventDefault() }
    const onKey = (e: KeyboardEvent) => {
      if (document.pointerLockElement !== overlay) return
      if (e.key === 'Escape') return // let the browser release the lock
      e.preventDefault()
      const mods: string[] = []
      if (e.metaKey) mods.push('cmd')
      if (e.ctrlKey) mods.push('ctrl')
      if (e.altKey) mods.push('alt')
      if (e.shiftKey) mods.push('shift')
      const special: Record<string, string> = { Enter: 'enter', Backspace: 'backspace', Tab: 'tab', Delete: 'delete', ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown', ' ': 'space' }
      if (special[e.key]) { ctl?.key(special[e.key], mods); return }
      if (e.key.length === 1) {
        if (e.metaKey || e.ctrlKey || e.altKey) ctl?.key(e.key, mods)
        else ctl?.type(e.key)
      }
    }
    const onLockChange = () => setPointerLocked(document.pointerLockElement === overlay)

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('wheel', onWheel, { passive: false })
    document.addEventListener('contextmenu', onCtx)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerlockchange', onLockChange)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('wheel', onWheel)
      document.removeEventListener('contextmenu', onCtx)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerlockchange', onLockChange)
      if (document.pointerLockElement === overlay) document.exitPointerLock()
      if (raf) cancelAnimationFrame(raf)
      setPointerLocked(false)
    }
  }, [controlMode])

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
    setSharingEntireScreen(false)
    setShareLabel('')
    setActiveSlot('primary')
  }, [localParticipant, secondaryStream, localShareStream])

  useEffect(() => { stopShareRef.current = stopShare }, [stopShare])

  const startShare = useCallback(async (forceHide = false) => {
    const shouldHide = clearBeforeShare || forceHide
    if (shouldHide) {
      setRoomHidden(true)
      await new Promise(r => setTimeout(r, 400))
    }
    try {
      await localParticipant.setScreenShareEnabled(true)
      if (shouldHide) setRoomHidden(false)
      const pub = localParticipant.getTrackPublication(Track.Source.ScreenShare)
      const mediaTrack = (pub?.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined
      const label = mediaTrack?.label || 'Your screen'
      if (mediaTrack) {
        const stream = new MediaStream([mediaTrack])
        setLocalShareStream(stream)
        // If the user chose a whole monitor in the native dialog, the preview
        // would echo — suppress it (see sharingEntireScreen).
        setSharingEntireScreen(mediaTrack.getSettings().displaySurface === 'monitor')
        mediaTrack.addEventListener('ended', () => stopShareRef.current?.())
      }
      setShareLabel(label)
      setIsSharing(true)
      setShareMenu(false)
    } catch {
      if (shouldHide) setRoomHidden(false)
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

  // Pop-out handler — defined here so it can read share state (localShareStream,
  // isSharing) which is declared above. Opens the presentation in a new window.
  const handlePopOut = useCallback(() => {
    if (popOutWinRef.current && !popOutWinRef.current.closed) {
      popOutWinRef.current.focus()
      return
    }

    // Pick the stream to pop out: a remote presenter's share if we're viewing
    // one, otherwise our own share if we're the presenter.
    const remoteTrackRef = remoteScreenTracks[0]
    const remoteMst: MediaStreamTrack | undefined =
      ((remoteTrackRef?.publication as any)?.track)?.mediaStreamTrack
    const localMst: MediaStreamTrack | undefined = localShareStream?.getVideoTracks()[0]
    const mst: MediaStreamTrack | undefined = remoteMst || localMst

    const w = window.open(
      '',
      'beehive-popout',
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
    )
    if (!w) return

    w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Shared content | BeeHive</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;background:#060606;overflow:hidden;font-family:'Roboto',sans-serif}
    #root{display:flex;flex-direction:column;width:100%;height:100%;align-items:center;justify-content:center}
    video{width:100%;height:100%;object-fit:contain;background:#060606}
    #badge{position:fixed;top:14px;left:14px;display:flex;align-items:center;gap:6px;
           background:rgba(0,0,0,.65);backdrop-filter:blur(6px);border:1px solid #48bb78;
           border-radius:20px;padding:4px 10px;color:#48bb78;font-size:11px;font-weight:600;letter-spacing:1px}
    #dot{width:7px;height:7px;border-radius:50%;background:#48bb78;animation:pulse 1.5s ease-in-out infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
    #placeholder{color:#555;font-size:14px;font-weight:300;text-align:center;padding:24px}
  </style>
</head>
<body>
  <div id="root">
    <video id="v" autoplay playsinline></video>
    <div id="placeholder" style="display:none">Waiting for shared content…</div>
  </div>
  <div id="badge"><div id="dot"></div>LIVE</div>
</body>
</html>`)
    w.document.close()

    const attach = () => {
      const video = w.document.getElementById('v') as HTMLVideoElement | null
      const placeholder = w.document.getElementById('placeholder') as HTMLElement | null
      if (!video) return
      if (mst) {
        video.srcObject = new MediaStream([mst])
        video.play().catch(() => {})
        if (placeholder) placeholder.style.display = 'none'
      } else {
        if (placeholder) placeholder.style.display = 'block'
        video.style.display = 'none'
      }
    }

    if (w.document.readyState === 'complete') {
      attach()
    } else {
      w.addEventListener('load', attach)
    }

    popOutWinRef.current = w
    setIsPoppedOut(true)

    const poll = setInterval(() => {
      if (w.closed) {
        setIsPoppedOut(false)
        popOutWinRef.current = null
        clearInterval(poll)
      }
    }, 500)
  }, [remoteScreenTracks, localShareStream])

  // Auto-close the pop-out when there's no longer anything being shared
  useEffect(() => {
    const stillSharing = hasRemoteScreenShare || isSharing
    if (!stillSharing && popOutWinRef.current && !popOutWinRef.current.closed) {
      const w = popOutWinRef.current
      try { w.document.title = 'Share ended — BeeHive' } catch {}
      setTimeout(() => { if (!w.closed) w.close() }, 1500)
      setIsPoppedOut(false)
      popOutWinRef.current = null
    }
  }, [hasRemoteScreenShare, isSharing])

  // Presenter slideshow control — drives Keynote / PowerPoint via the desktop
  // app, so the presenter can advance slides from the main area or fullscreen
  // without switching back to the presentation app. macOS desktop only.
  const canControlSlides = !!window.electronAPI && isSharing
  const controlSlides = useCallback((direction: 'next' | 'prev') => {
    window.electronAPI?.presentationControl(direction)
  }, [])

  // Keyboard slide navigation while presenting (ignore when typing in a field)
  useEffect(() => {
    if (!canControlSlides) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault(); controlSlides('next')
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault(); controlSlides('prev')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canControlSlides, controlSlides])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    // Mark incoming DMs as unread when the card isn't expanded
    const last = messages[messages.length - 1]
    if (!last?.message.startsWith('__DM__')) return
    try {
      const { from, to } = JSON.parse(last.message.slice(6))
      const peer = from === displayName ? to : from
      if (from !== displayName && (to === displayName)) {
        setDmUnread(prev => expandedDms.has(peer) ? prev : new Set([...prev, peer]))
        setOpenDms(prev => new Set([...prev, peer]))
      }
    } catch { /* ignore malformed */ }
  }, [messages])

  const handleSend = async () => {
    if (!chatInput.trim()) return
    await sendMessage(chatInput, displayName)
    setChatInput('')
  }

  const leaveWithNotification = useCallback(async () => {
    try {
      await supabase.from('chat_messages').insert({ room_id: roomId, display_name: '__SYSTEM__', message: `__LEAVE__${displayName}` })
      await supabase.from('room_participants').update({ is_active: false }).eq('room_id', roomId).eq('display_name', displayName)
      const { count } = await supabase.from('room_participants').select('id', { count: 'exact', head: true }).eq('room_id', roomId).eq('is_active', true)
      if ((count ?? 0) === 0) {
        await supabase.from('rooms').update({ ended_at: new Date().toISOString(), is_active: false }).eq('id', roomId)
      }
    } catch { /* best-effort */ }
    onLeave()
  }, [roomId, displayName, onLeave])

  useEffect(() => {
    supabase.from('chat_messages').insert({ room_id: roomId, display_name: '__SYSTEM__', message: `__JOIN__${displayName}` }).then(() => {})
    return () => {
      supabase.from('room_participants').update({ is_active: false }).eq('room_id', roomId).eq('display_name', displayName).then(() => {})
    }
  }, [roomId, displayName])

  const aloneStartRef = useRef<number | null>(null)
  const [aloneCountdown, setAloneCountdown] = useState<number | null>(null)
  const ALONE_LIMIT = 10 * 60 * 1000

  const meetingStartRef = useRef<number>(Date.now())
  const [elapsedDisplay, setElapsedDisplay] = useState('0:00')
  useEffect(() => {
    const t = setInterval(() => {
      const sec = Math.floor((Date.now() - meetingStartRef.current) / 1000)
      const h = Math.floor(sec / 3600)
      const m = Math.floor((sec % 3600) / 60)
      const s = sec % 60
      setElapsedDisplay(h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(t)
  }, [])
  const WARN_AT = 60 * 1000

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
      setPresentStep('opening')
      setPresentAppName(presentationApp(pendingFile.name))
      const filePath = window.electronAPI.getFilePath(pendingFile)
      if (filePath) {
        await window.electronAPI.openFile(filePath)
      }
      await new Promise(r => setTimeout(r, 1200))
      setPresentStep('waiting')
    } else {
      setPresentStep('opening')
      setPendingFile(null)
      await new Promise(r => setTimeout(r, 150))
      setPresentStep('idle')
      await startShare()
    }
  }, [pendingFile, startShare])

  const checkScreenPermission = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI) return true
    const status = await window.electronAPI.getScreenAccessStatus()
    if (status !== 'granted') {
      alert('Screen Recording permission is required.\n\nGo to System Settings → Privacy & Security → Screen Recording and enable BeeHive, then relaunch the app.')
      return false
    }
    return true
  }, [])

  const shareDesktopSource = useCallback(async (sourceId: string, isEntireScreen = false, windowTitle = '') => {
    setShowWindowPicker(false)
    controlWindowTitleRef.current = windowTitle
    if (!(await checkScreenPermission())) return
    try {
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

      const livekitTrack = new LocalVideoTrack(rawTrack, undefined, false)
      await localParticipant.publishTrack(livekitTrack, { source: Track.Source.ScreenShare })

      setLocalShareStream(stream)
      setShareLabel(windowTitle || rawTrack.label || 'Presentation')
      setIsSharing(true)
      setSharingEntireScreen(isEntireScreen)
      rawTrack.addEventListener('ended', () => stopShareRef.current?.())
    } catch {
      alert('Could not capture screen. Make sure BeeHive has Screen Recording permission in System Settings → Privacy & Security → Screen Recording.')
    }
  }, [localParticipant, checkScreenPermission])

  // Share the primary/entire screen:
  //   • Electron — resolves the primary display via display_id sort and captures
  //     it directly via the desktop capturer path (no OS picker shown).
  //   • Web — calls getDisplayMedia with displaySurface:'monitor' so the browser
  //     native picker opens with the full-screen option pre-selected, not tabs.
  const shareEntireScreen = useCallback(async () => {
    if (window.electronAPI) {
      if (!(await checkScreenPermission())) return
      const sources = await window.electronAPI.getDesktopSources({
        types: ['screen'],
        thumbnailSize: { width: 320, height: 180 },
      })
      if (sources.length === 0) return
      // Primary display has the lowest numeric display_id on both macOS and Windows.
      const sorted = [...sources].sort((a, b) => {
        const ai = parseInt(a.display_id || '9999', 10)
        const bi = parseInt(b.display_id || '9999', 10)
        return ai - bi
      })
      await shareDesktopSource(sorted[0].id, true)
    } else {
      // Web path: bypass LiveKit's setScreenShareEnabled so we can pass
      // displaySurface:'monitor' — the standard hook doesn't forward constraints.
      const shouldHide = clearBeforeShare
      if (shouldHide) {
        setRoomHidden(true)
        await new Promise(r => setTimeout(r, 400))
      }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'monitor' } as any,
          audio: false,
        })
        if (shouldHide) setRoomHidden(false)
        const [rawTrack] = stream.getVideoTracks()
        if (!rawTrack) { stream.getTracks().forEach(t => t.stop()); return }
        const livekitTrack = new LocalVideoTrack(rawTrack, undefined, false)
        await localParticipant.publishTrack(livekitTrack, { source: Track.Source.ScreenShare })
        setLocalShareStream(stream)
        setShareLabel(rawTrack.label || 'Your screen')
        setIsSharing(true)
        // Monitor capture on the same display echoes; suppress the local preview.
        setSharingEntireScreen((rawTrack.getSettings().displaySurface ?? 'monitor') === 'monitor')
        setShareMenu(false)
        rawTrack.addEventListener('ended', () => stopShareRef.current?.())
      } catch {
        if (shouldHide) setRoomHidden(false)
      }
    }
  }, [checkScreenPermission, shareDesktopSource, clearBeforeShare, localParticipant])

  const sharePresentationWindow = useCallback(async () => {
    if (!window.electronAPI) return
    if (!(await checkScreenPermission())) return
    setDetectingWindow(true)
    try {
      const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
      const keywords = ['keynote', 'powerpoint', 'impress', 'slides']
      const match = sources.find(src =>
        keywords.some(kw => src.name.toLowerCase().includes(kw))
      )
      if (match) {
        setPendingSource({ id: match.id, name: match.name, thumbnail: match.thumbnail })
      } else {
        setDesktopSources(sources)
        setShowWindowPicker(true)
      }
    } finally {
      setDetectingWindow(false)
    }
  }, [checkScreenPermission])

  const confirmAndShare = useCallback(async () => {
    if (!pendingSource) return
    window.electronAPI?.stopFloating()
    setPendingFile(null)
    setPresentStep('idle')
    const id = pendingSource.id
    const name = pendingSource.name
    setPendingSource(null)
    await shareDesktopSource(id, false, name)
  }, [pendingSource, shareDesktopSource])

  const openQueuedFile = useCallback(async (file: File) => {
    if (!window.electronAPI) return
    const filePath = window.electronAPI.getFilePath(file)
    if (filePath) {
      await window.electronAPI.openFile(filePath)
    }
    await new Promise(r => setTimeout(r, 1200))
    const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
    const keywords = ['keynote', 'powerpoint', 'impress', 'slides']
    const match = sources.find(src => keywords.some(kw => src.name.toLowerCase().includes(kw)))
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

  const sendReaction = (emoji: string, message?: string) => {
    const now = Date.now()
    if (now - lastReactionAt.current < REACTION_COOLDOWN_MS) return
    lastReactionAt.current = now
    reactionChannelRef.current?.send({
      type: 'broadcast', event: 'reaction',
      payload: { emoji, message: message ?? '', senderName: displayName },
    })
  }

  const openComposer = (emoji: string, btn: HTMLElement) => {
    const rect = btn.getBoundingClientRect()
    setReactionComposer({
      emoji,
      text: getReactionTemplate(emoji, displayName),
      anchor: { x: rect.left, y: rect.top, width: rect.width },
    })
  }

  const handleEmojiPointerDown = (emoji: string, e: React.PointerEvent<HTMLButtonElement>) => {
    emojiLongPressed.current = false
    emojiLongPressTimer.current = setTimeout(() => {
      emojiLongPressed.current = true
      openComposer(emoji, e.currentTarget)
    }, 450)
  }

  const cancelEmojiLongPress = () => {
    if (emojiLongPressTimer.current) {
      clearTimeout(emojiLongPressTimer.current)
      emojiLongPressTimer.current = null
    }
  }

  const handleEmojiClick = (emoji: string, closePicker: () => void) => {
    if (emojiLongPressed.current) { emojiLongPressed.current = false; return }
    sendReaction(emoji)
    closePicker()
  }

  const handleEmojiContextMenu = (emoji: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    cancelEmojiLongPress()
    openComposer(emoji, e.currentTarget)
  }

  const toggleSpeaker = () => {
    const next = !speakerMuted
    document.querySelectorAll<HTMLAudioElement>('audio').forEach(a => { a.muted = next })
    setSpeakerMuted(next)
  }

  const handleInviteBtn = () => {
    setShowInviteModal(true)
  }

  const activeCount = liveKitParticipants.length

  return (
    <div style={{ ...s.roomWrapper, opacity: roomHidden ? 0 : 1, transition: 'opacity 0.3s', pointerEvents: roomHidden ? 'none' : 'auto' }}>
      {/* Header */}
      <div style={{
        ...s.header,
        paddingLeft: window.electronAPI ? 88 : (isMobile ? 12 : 18),
        paddingRight: isMobile ? 12 : 18,
        paddingTop: isMobile ? 10 : 14,
        paddingBottom: isMobile ? 10 : 14,
        position: 'relative',
        minHeight: isMobile ? 44 : 52,
      }}>
        <div style={{ ...s.headerLeft, gap: isMobile ? 6 : 10 }}>
          <span style={{ ...s.roomTitle, fontSize: isMobile ? 12 : 16, letterSpacing: isMobile ? 2 : 3 }}>{APP_NAME}</span>
          <button
            style={{ ...s.pill, fontSize: isMobile ? 11 : 12, padding: isMobile ? '2px 8px' : '3px 10px' }}
            onClick={() => !isMobile && setShowParticipants(v => !v)}
          >
            {isSmallPhone ? activeCount : `${activeCount} ${activeCount === 1 ? 'participant' : 'participants'}`}
          </button>
        </div>

        {/* Timer — desktop only in header; mobile uses floating pill */}
        {!isMobile && (
          <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', color: '#555', fontSize: 13, fontWeight: 300, fontFamily: "'Roboto', sans-serif", letterSpacing: 1, pointerEvents: 'none', WebkitAppRegion: 'drag' as any }}>
            {elapsedDisplay}
          </div>
        )}

        <div style={{ ...s.headerRight, gap: isMobile ? 6 : 8 }}>
          {/* Hide Stop Sharing + chat icon on mobile — accessible via controls */}
          {!isMobile && isSharing && (
            <button
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#276127', border: '1px solid #48bb78', borderRadius: 8, color: '#48bb78', padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
              onClick={stopShare}
              title="Stop sharing"
            >
              <MonitorOff size={14} /> Stop Sharing
            </button>
          )}
          {!isMobile && (
            <button style={s.iconBtn} onClick={() => setShowChat(v => !v)} title="Toggle chat">
              <MessageSquare size={18} />
            </button>
          )}
          <button
            style={{ ...s.leaveBtn, padding: isMobile ? '5px 12px' : '7px 16px', fontSize: isMobile ? 12 : 13 }}
            onClick={leaveWithNotification}
          >Leave</button>
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

      {/* Docked participants strip */}
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
            onDirectChat={name => { openDm(name); setShowChat(true) }}
          />
        )}

        {/* Drop overlay */}
        {dragOver && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(245,166,35,0.1)', border: '3px dashed #f5a623', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, pointerEvents: 'none' }}>
            <Paperclip size={48} color="#f5a623" />
            <span style={{ color: '#f5a623', fontSize: 18, fontWeight: 300, fontFamily: "'Roboto', sans-serif", letterSpacing: 1 }}>Drop to share with attendees</span>
            <span style={{ color: '#f5a623', fontSize: 13, fontWeight: 300, fontFamily: "'Roboto', sans-serif", opacity: 0.7 }}>Presentation files open automatically for window sharing</span>
          </div>
        )}

        {/* Video Grid */}
        <div
          ref={mainAreaRef}
          style={{
            ...(isFullscreen
              ? { position: 'fixed', inset: 0, zIndex: 9000 }
              : { flex: 1, position: 'relative' }),
            overflow: 'hidden',
            background: '#060606',
            cursor: laserActive ? 'crosshair' : undefined,
          }}
          onMouseMove={handleMainAreaMouseMove}
          onMouseLeave={handleMainAreaMouseLeave}
        >
          {hasRemoteScreenShare ? (
            <ParticipantTile
              trackRef={remoteScreenTracks[0]}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : isSharing ? (
            <div style={{ width: '100%', height: '100%', position: 'relative', background: '#060606' }}>
              {localShareStream && !sharingEntireScreen ? (
                <video
                  ref={el => { shareVideoRef.current = el; if (el && el.srcObject !== localShareStream) { el.srcObject = localShareStream; el.play().catch(() => {}) } }}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  muted
                  playsInline
                  autoPlay
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  <Monitor size={30} color="#48bb78" />
                  <p style={{ color: '#48bb78', fontSize: 15, fontWeight: 400, fontFamily: "'Roboto', sans-serif", margin: 0 }}>
                    {sharingEntireScreen ? 'Sharing your entire screen' : 'Broadcasting…'}
                  </p>
                  {sharingEntireScreen && (
                    <p style={{ color: '#666', fontSize: 12, fontWeight: 300, fontFamily: "'Roboto', sans-serif", margin: 0, textAlign: 'center', maxWidth: 320 }}>
                      Preview hidden here to prevent a mirror loop — everyone else sees your screen normally.
                    </p>
                  )}
                </div>
              )}
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', border: '1px solid #48bb78', borderRadius: 20, padding: '4px 10px' }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#48bb78', animation: 'pulse 1.5s ease-in-out infinite' }} />
                <span style={{ color: '#48bb78', fontSize: 11, fontWeight: 600, fontFamily: "'Roboto', sans-serif", letterSpacing: 1 }}>LIVE</span>
              </div>

              {/* Interactive control overlay — Pointer Lock captures the cursor and
                  drives the shared window from relative deltas (no bounce). A
                  synthetic cursor shows where you're pointing. */}
              {controlMode && (() => {
                const box = shareContentBox()
                const cur = box ? { left: box.ox + controlCursor.x * box.cw, top: box.oy + controlCursor.y * box.ch } : null
                return (
                  <div ref={controlOverlayRef} style={{ position: 'absolute', inset: 0, zIndex: 20, cursor: 'none', outline: 'none' }}>
                    {pointerLocked && cur && (
                      <div style={{ position: 'absolute', left: cur.left, top: cur.top, width: 18, height: 18, marginLeft: -9, marginTop: -9, borderRadius: '50%', border: '2px solid #4299e1', background: 'rgba(66,153,225,0.35)', boxShadow: '0 0 0 1px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
                    )}
                    {!pointerLocked && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(66,153,225,0.2)', border: '1px solid #4299e1', borderRadius: 22, padding: '9px 18px', color: '#cbe6ff', fontSize: 13, fontFamily: "'Roboto', sans-serif" }}>
                          <MousePointer2 size={15} /> Click to control · Esc to release
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
              {controlMode && (
                <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(66,153,225,0.18)', backdropFilter: 'blur(6px)', border: '1px solid #4299e1', borderRadius: 20, padding: '4px 12px', zIndex: 21, pointerEvents: 'none' }}>
                  <MousePointer2 size={12} color="#4299e1" />
                  <span style={{ color: '#4299e1', fontSize: 11, fontWeight: 600, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5 }}>{pointerLocked ? 'CONTROLLING' : 'PAUSED'}</span>
                </div>
              )}
            </div>
          ) : (
            <GridLayout tracks={cameraTracks} style={{ height: '100%' }}>
              <ParticipantTile />
            </GridLayout>
          )}

          {/* Mobile floating timer — just below the header, centred over video */}
          {isMobile && (
            <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', borderRadius: 12, padding: '3px 12px', zIndex: 5, pointerEvents: 'none' }}>
              <span style={{ color: '#666', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", letterSpacing: 1 }}>{elapsedDisplay}</span>
            </div>
          )}

          {/* Top-right button cluster: Laser pointer + Pop out + Expand/Collapse */}
          {(overlayMode !== 'hidden' || isFullscreen) && (
            <div style={{ position: 'absolute', top: 14, right: 14, zIndex: 9100, display: 'flex', gap: 6 }}>
              {/* Laser pointer — desktop only (needs mouse cursor) */}
              {!isMobile && (
                <button
                  onClick={() => setLaserActive(v => !v)}
                  title={laserActive ? 'Turn off laser pointer' : 'Laser pointer — show your cursor to everyone'}
                  style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: laserActive ? `${myColor}33` : 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', border: `1px solid ${laserActive ? myColor : '#333'}`, borderRadius: 8, color: laserActive ? myColor : '#ccc', cursor: 'pointer' }}
                >
                  <Crosshair size={17} />
                </button>
              )}
              {/* Control shared window — desktop only, while sharing a window.
                  Forwards mouse/scroll/keyboard from this preview to the source. */}
              {canControlShare && (
                <button
                  onClick={toggleControlMode}
                  title={controlMode ? 'Stop controlling the shared window' : 'Control the shared window from here'}
                  style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: controlMode ? 'rgba(66,153,225,0.25)' : 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', border: `1px solid ${controlMode ? '#4299e1' : '#333'}`, borderRadius: 8, color: controlMode ? '#4299e1' : '#ccc', cursor: 'pointer' }}
                >
                  <MousePointer2 size={17} />
                </button>
              )}
              {/* Pop-out presentation — desktop only. Hidden for a local entire-screen
                  share (no remote share to show): a pop-out window would itself be
                  captured and echo. Remote shares are always safe to pop out. */}
              {!isMobile && (hasRemoteScreenShare || (isSharing && !sharingEntireScreen)) && (
                <button
                  onClick={handlePopOut}
                  title={isPoppedOut ? 'Pop-out window is open — click to focus' : 'Pop out presentation to a separate window'}
                  style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isPoppedOut ? 'rgba(66,153,225,0.25)' : 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', border: `1px solid ${isPoppedOut ? '#4299e1' : '#333'}`, borderRadius: 8, color: isPoppedOut ? '#4299e1' : '#ccc', cursor: 'pointer' }}
                >
                  <ExternalLink size={17} />
                </button>
              )}
              <button
                onClick={toggleFullscreen}
                title={isFullscreen ? 'Exit full screen' : 'Expand to full screen'}
                style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', border: '1px solid #333', borderRadius: 8, color: '#ccc', cursor: 'pointer' }}
              >
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          )}

          {/* Presenter slide controls — control Keynote / PowerPoint from the
              main area and in fullscreen (desktop only, while sharing) */}
          {canControlSlides && (
            <>
              <button
                onClick={() => controlSlides('prev')}
                title="Previous slide (←)"
                style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 9100, width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', border: '1px solid #333', borderRadius: '50%', color: '#eee', cursor: 'pointer' }}
              >
                <ChevronLeft size={24} />
              </button>
              <button
                onClick={() => controlSlides('next')}
                title="Next slide (→ / Space)"
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', zIndex: 9100, width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)', border: '1px solid #333', borderRadius: '50%', color: '#eee', cursor: 'pointer' }}
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}

          {/* Active Share Bar */}
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

          {/* Speaking Indicator */}
          <SpeakingIndicator overlayMode={isPresenting ? overlayMode : 'visible'} isPresenting={isPresenting} />

          {/* Remote laser pointer cursors */}
          {Array.from(remoteCursors.entries()).map(([name, cur]) => (
            <div
              key={name}
              style={{ position: 'absolute', left: `${cur.x * 100}%`, top: `${cur.y * 100}%`, zIndex: 90, pointerEvents: 'none', transform: 'translate(-50%, -50%)' }}
            >
              <div style={{ width: 14, height: 14, borderRadius: '50%', background: cur.color, border: '2px solid #fff', boxShadow: `0 0 8px ${cur.color}` }} />
              <span style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', background: cur.color, color: '#000', fontSize: 10, fontWeight: 700, fontFamily: "'Roboto', sans-serif", borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' as const, letterSpacing: 0.5 }}>{name.split(' ')[0]}</span>
            </div>
          ))}

          {/* Floating Reactions — emoji-only column (original behaviour) */}
          <div style={s.reactionFloat}>
            {floatingReactions.filter(r => !r.message).map(r => (
              <span key={r.id} style={s.floatingEmoji}>{r.emoji}</span>
            ))}
          </div>

          {/* Floating Reaction Pills — glassmorphism, individually positioned */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, overflow: 'hidden' }} aria-live="polite">
            {floatingReactions.filter(r => !!r.message).map(r => (
              <div
                key={r.id}
                role="status"
                aria-label={`${r.senderName} reacted: ${r.message}`}
                style={{
                  position: 'absolute',
                  bottom: 90,
                  left: `calc(50% + ${r.x}px)`,
                  transform: 'translateX(-50%)',
                  background: 'rgba(16,16,16,0.86)',
                  backdropFilter: 'blur(18px)',
                  WebkitBackdropFilter: 'blur(18px)',
                  border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: 28,
                  padding: '9px 16px 9px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  maxWidth: 320,
                  boxShadow: '0 6px 28px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.04) inset',
                  animation: 'pillFloat 3.2s ease-out forwards',
                  fontFamily: "'Roboto', sans-serif",
                  fontSize: 13,
                  fontWeight: 300,
                  color: '#ddd',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                <span style={{ fontSize: 19, lineHeight: 1, flexShrink: 0 }}>{r.emoji}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.message}</span>
              </div>
            ))}
          </div>

          {/* Raised hands — chips in top-right; host can dismiss individually or clear all */}
          {raisedHands.length > 0 && (
            <div style={{ position: 'absolute', top: 66, right: 14, zIndex: 15, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              {raisedHands.map(h => (
                <div key={h.identity} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(12px)', border: '1px solid #444', borderRadius: 24, padding: '6px 10px 6px 12px', fontSize: 13, color: '#fff', fontFamily: "'Roboto', sans-serif", fontWeight: 300, whiteSpace: 'nowrap' as const }}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>✋</span>
                  <span>{h.name}</span>
                  <button onClick={() => dismissHand(h.identity)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', display: 'flex', alignItems: 'center', padding: 0, marginLeft: 2 }} title="Lower hand">
                    <X size={13} />
                  </button>
                </div>
              ))}
              {raisedHands.length > 1 && (
                <button onClick={lowerAllHands} style={{ background: 'rgba(10,10,10,0.7)', border: '1px solid #333', borderRadius: 20, padding: '4px 14px', color: '#888', fontSize: 11, fontFamily: "'Roboto', sans-serif", cursor: 'pointer' }}>
                  Lower all
                </button>
              )}
            </div>
          )}

          {/* Restore pill */}
          {isPresenting && overlayMode === 'hidden' && (
            <button
              onClick={() => setOverlayMode('visible')}
              style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(10px)', border: '1px solid #f5a623', borderRadius: 30, padding: '7px 18px', color: '#f5a623', fontSize: 12, fontFamily: "'Roboto', sans-serif", cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, zIndex: 20 }}
            >
              <Monitor size={14} /> Show controls
            </button>
          )}

          {/* Controls Bar */}
          {isMobile ? (
            /* ── Mobile controls ─────────────────────────────────────────── */
            overlayMode !== 'hidden' && (() => {
              const btnSize = isSmallPhone ? 40 : 46
              const mb: React.CSSProperties = { background: '#2a2a2a', border: 'none', borderRadius: 50, width: btnSize, height: btnSize, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', position: 'relative', flexShrink: 0 }
              return (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10 }}>

                  {/* Emoji picker — floats above scroll bar */}
                  {showMobileEmoji && (
                    <div style={{ position: 'absolute', bottom: btnSize + 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4, background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(14px)', borderRadius: 30, padding: '6px 10px', border: '1px solid #2a2a2a', maxWidth: 'calc(100vw - 40px)', justifyContent: 'center', zIndex: 20 }}>
                      {REACTIONS.map(e => (
                        <button
                          key={e}
                          style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', padding: '2px 4px', borderRadius: 8 }}
                          aria-label={`React with ${e}`}
                          onPointerDown={ev => handleEmojiPointerDown(e, ev)}
                          onPointerUp={cancelEmojiLongPress}
                          onPointerCancel={cancelEmojiLongPress}
                          onClick={() => handleEmojiClick(e, () => setShowMobileEmoji(false))}
                          onContextMenu={ev => { handleEmojiContextMenu(e, ev); setShowMobileEmoji(false) }}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Dropdown menus — rendered outside the overflow container so they aren't clipped */}
                  {bgMenuOpen && (
                    <BackgroundMenu
                      effect={bgEffect} presetId={bgPresetId} flip={bgFlip} blurLevel={blurLevel}
                      uploadedImageName={bgUploadedImageName}
                      onEffect={e => { setBgEffect(e); if (e === 'none') setBgFlip(false) }}
                      onPreset={setBgPresetId} onFlip={() => setBgFlip(v => !v)} onBlur={setBlurLevel}
                      onImageUpload={handleImageUpload} onClose={() => setBgMenuOpen(false)}
                    />
                  )}
                  {showAutoCamMenu && !autoCamMode && (
                    <div style={{ ...s.autoCamMenu }}>
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
                  {showQuality && (
                    <div style={{ ...s.qualityMenu }}>
                      {QUALITY_OPTIONS.map(q => (
                        <button key={q} style={{ ...s.qualityOption, ...(quality === q ? s.qualityActive : {}) }}
                          onClick={() => { setQuality(q); setShowQuality(false) }}>{q}</button>
                      ))}
                    </div>
                  )}
                  {shareMenu && !isSharing && (
                    <ScreenShareMenu
                      clearBeforeShare={clearBeforeShare}
                      onToggleClear={() => setClearBeforeShare(v => !v)}
                      onEntireScreen={async () => { setShareMenu(false); await shareEntireScreen() }}
                      onSelectWindow={async () => {
                        setShareMenu(false)
                        if (window.electronAPI) {
                          if (!(await checkScreenPermission())) return
                          const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
                          setDesktopSources(sources); setShowWindowPicker(true)
                        } else { await startShare() }
                      }}
                      onClose={() => setShareMenu(false)}
                    />
                  )}

                  {/* Single horizontally scrollable row — all controls visible, scroll to reach more */}
                  <style>{`.beehive-ctrl-scroll::-webkit-scrollbar { display: none }`}</style>
                  <div
                    className="beehive-ctrl-scroll"
                    style={{ overflowX: 'auto', scrollbarWidth: 'none' as any, background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(14px)', padding: `${isSmallPhone ? 8 : 10}px 16px`, paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${isSmallPhone ? 8 : 10}px)` }}
                  >
                    <div style={{ display: 'flex', gap: isSmallPhone ? 6 : 10, width: 'max-content' }}>
                      {/* Mic */}
                      <TrackToggle source={Track.Source.Microphone} style={mb} showIcon />
                      {/* Speaker mute */}
                      <button
                        style={{ ...mb, ...(speakerMuted ? { background: '#4a1a1a', border: '1px solid #fc8181' } : {}) }}
                        onClick={toggleSpeaker}
                        title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                      >
                        {speakerMuted ? <VolumeX size={isSmallPhone ? 16 : 18} /> : <Volume2 size={isSmallPhone ? 16 : 18} />}
                      </button>
                      {/* Camera */}
                      <TrackToggle source={Track.Source.Camera} style={mb} showIcon />
                      {/* Reactions */}
                      <button
                        style={{ ...mb, ...(showMobileEmoji ? { background: '#2a2010', border: '1px solid #f5a623' } : {}) }}
                        onClick={() => { setShowMobileEmoji(v => !v); setBgMenuOpen(false); setShowQuality(false); setShareMenu(false); setShowAutoCamMenu(false) }}
                        title="Reactions"
                      >
                        <Smile size={isSmallPhone ? 16 : 18} />
                      </button>
                      {/* Invite link */}
                      <button style={mb} onClick={handleInviteBtn} title="Invite link">
                        <Link size={isSmallPhone ? 16 : 18} />
                      </button>
                      {/* Raise Hand */}
                      <button
                        style={{ ...mb, ...(myHandRaised ? { background: '#2a3a1a', border: '1px solid #68d391' } : {}) }}
                        onClick={toggleRaiseHand}
                        title={myHandRaised ? 'Lower hand' : 'Raise hand'}
                      >
                        <Hand size={isSmallPhone ? 16 : 18} />
                      </button>
                      {/* Background */}
                      <button
                        style={{ ...mb, ...(bgActive ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                        onClick={() => { setBgMenuOpen(v => !v); setShowMobileEmoji(false); setShowQuality(false); setShareMenu(false); setShowAutoCamMenu(false) }}
                        title="Background"
                      >
                        <Layers size={isSmallPhone ? 16 : 18} />
                      </button>
                      {/* Auto Cam */}
                      <button
                        style={{ ...mb, ...(autoCamMode ? { background: '#1a2e4a', border: '1px solid #4299e1' } : {}) }}
                        onClick={() => {
                          if (autoCamMode) { setAutoCamMode(null); setShowAutoCamMenu(false) }
                          else { setShowAutoCamMenu(v => !v); setBgMenuOpen(false); setShowQuality(false); setShareMenu(false); setShowMobileEmoji(false) }
                        }}
                        title="Auto cam"
                      >
                        <Aperture size={isSmallPhone ? 16 : 18} />
                      </button>
                      {/* Quality */}
                      <button
                        style={{ ...mb, ...(showQuality ? { background: '#333', border: '1px solid #555' } : {}) }}
                        onClick={() => { setShowQuality(v => !v); setBgMenuOpen(false); setShowAutoCamMenu(false); setShareMenu(false); setShowMobileEmoji(false) }}
                        title="Quality"
                      >
                        <Film size={isSmallPhone ? 16 : 18} />
                        <span style={s.hdBadge}>HD</span>
                      </button>
                      {/* Screen Share */}
                      <button
                        style={{ ...mb, ...(isSharing ? { background: '#276127', border: '1px solid #48bb78' } : {}) }}
                        onClick={() => {
                          if (isSharing) stopShare()
                          else { setShareMenu(v => !v); setBgMenuOpen(false); setShowAutoCamMenu(false); setShowQuality(false); setShowMobileEmoji(false) }
                        }}
                        title={isSharing ? 'Stop sharing' : 'Share screen'}
                      >
                        {isSharing ? <MonitorOff size={isSmallPhone ? 16 : 18} /> : <Monitor size={isSmallPhone ? 16 : 18} />}
                      </button>
                      {/* Chat */}
                      <button
                        style={{ ...mb, ...(showChat ? { background: '#1a1a4a', border: '1px solid #5b5ef4' } : {}) }}
                        onClick={() => setShowChat(v => !v)}
                        title="Chat"
                      >
                        <MessageSquare size={isSmallPhone ? 16 : 18} />
                      </button>
                      {/* Leave */}
                      <button style={{ ...mb, background: '#c53030' }} onClick={leaveWithNotification} title="Leave">
                        <PhoneOff size={isSmallPhone ? 16 : 18} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })()
          ) : isPresenting && overlayMode === 'minimized' ? (
            /* ── Desktop: minimised presenter bar ────────────────────────── */
            <div style={{ ...s.controls, gap: 8, padding: '8px 14px' }}>
              <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} showIcon />
              <button
                style={{ ...s.controlBtn, ...(speakerMuted ? { background: '#4a1a1a', border: '1px solid #fc8181' } : {}) }}
                onClick={toggleSpeaker}
                title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
              >
                {speakerMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
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
            /* ── Desktop: full controls bar ──────────────────────────────── */
            <>
            <style>{`
              .bhv-btn {
                /* transform-origin: center keeps the pointer-event hit-area centred
                   on the visual at every scale. Never revert to bottom-center.    */
                position: relative;
              }
              .bhv-btn::before {
                /* Transparent overlay that extends the click zone beyond the visual
                   circle — 18 px extra on top and sides, 10 px on the bottom.
                   Especially important when the button is lifted and magnified: the
                   top half of the enlarged icon is the natural click target and needs
                   a generous hit area. The pseudo-element scales with the button's
                   CSS transform, so the expanded zone grows with the icon. */
                content: '';
                position: absolute;
                inset: -18px -18px -10px -18px;
                border-radius: 50%;
              }
              .bhv-btn:active {
                transform: scale(0.88) !important;
                filter: brightness(0.82) !important;
                transition: transform 0.07s ease, filter 0.07s ease !important;
              }
              .bhv-emoji:hover { filter: none !important; }
            `}</style>
            <div ref={controlsBarRef} style={{ ...s.controls, overflow: 'visible' }} className="controls-bar">
              <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} className="bhv-btn" showIcon />
              <button className="bhv-btn"
                style={{ ...s.controlBtn, ...(speakerMuted ? { background: '#4a1a1a', border: '1px solid #fc8181' } : {}) }}
                onClick={toggleSpeaker}
                title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
              >
                {speakerMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <TrackToggle source={Track.Source.Camera} style={s.controlBtn} className="bhv-btn" showIcon />

              {/* Background Effects */}
              <div style={{ position: 'relative' }}>
                <button className="bhv-btn"
                  style={{ ...s.controlBtn, ...(bgActive ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                  onClick={() => setBgMenuOpen(v => !v)}
                  title="Background effects"
                >
                  <Layers size={20} />
                </button>
                {bgMenuOpen && (
                  <BackgroundMenu
                    effect={bgEffect} presetId={bgPresetId} flip={bgFlip} blurLevel={blurLevel}
                    uploadedImageName={bgUploadedImageName}
                    onEffect={e => { setBgEffect(e); if (e === 'none') setBgFlip(false) }}
                    onPreset={setBgPresetId} onFlip={() => setBgFlip(v => !v)} onBlur={setBlurLevel}
                    onImageUpload={handleImageUpload} onClose={() => setBgMenuOpen(false)}
                  />
                )}
              </div>

              {/* Auto Cam */}
              <div style={{ position: 'relative' }}>
                <button className="bhv-btn"
                  style={{ ...s.controlBtn, ...(autoCamMode ? { background: '#1a2e4a', border: '1px solid #4299e1' } : {}) }}
                  onClick={() => { if (autoCamMode) { setAutoCamMode(null); setShowAutoCamMenu(false) } else setShowAutoCamMenu(v => !v) }}
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
                <button className="bhv-btn" style={{ ...s.controlBtn, ...(showReactions ? { background: '#2a2010', border: '1px solid #f5a623' } : {}) }} title="Reactions" onClick={() => setShowReactions(v => !v)}>
                  <Smile size={20} />
                </button>
                {showReactions && (
                  <div style={s.reactionBar}>
                    {REACTIONS.map(e => (
                      <button
                        key={e}
                        className="bhv-emoji"
                        style={s.emojiBtn}
                        title={`${e}  ·  hold for message`}
                        aria-label={`React with ${e}`}
                        onPointerDown={ev => handleEmojiPointerDown(e, ev)}
                        onPointerUp={cancelEmojiLongPress}
                        onPointerCancel={cancelEmojiLongPress}
                        onClick={() => handleEmojiClick(e, () => setShowReactions(false))}
                        onContextMenu={ev => { handleEmojiContextMenu(e, ev); setShowReactions(false) }}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Raise Hand */}
              <button className="bhv-btn"
                style={{ ...s.controlBtn, ...(myHandRaised ? { background: '#2a3a1a', border: '1px solid #68d391' } : {}) }}
                onClick={toggleRaiseHand}
                title={myHandRaised ? 'Lower hand' : 'Raise hand'}
              >
                <Hand size={20} />
              </button>

              {/* Invite Link */}
              <button className="bhv-btn" style={s.controlBtn} onClick={handleInviteBtn} title="Copy invite link">
                <Link size={20} />
              </button>

              {/* Video Quality */}
              <div style={{ position: 'relative' }}>
                <button className="bhv-btn" style={s.controlBtn} onClick={() => setShowQuality(v => !v)} title="Video quality">
                  <Film size={20} />
                  <span style={s.hdBadge}>HD</span>
                </button>
                {showQuality && (
                  <div style={s.qualityMenu}>
                    {QUALITY_OPTIONS.map(q => (
                      <button key={q} style={{ ...s.qualityOption, ...(quality === q ? s.qualityActive : {}) }}
                        onClick={() => { setQuality(q); setShowQuality(false) }}>{q}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* Screen Share */}
              <div style={{ position: 'relative' }}>
                <button className="bhv-btn"
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
                    onEntireScreen={async () => { setShareMenu(false); await shareEntireScreen() }}
                    onSelectWindow={async () => {
                      setShareMenu(false)
                      if (window.electronAPI) {
                        if (!(await checkScreenPermission())) return
                        const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
                        setDesktopSources(sources); setShowWindowPicker(true)
                      } else { await startShare() }
                    }}
                    onClose={() => setShareMenu(false)}
                  />
                )}
              </div>

              {isSharing && (
                <button className="bhv-btn"
                  style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#c53030', border: 'none', borderRadius: 24, color: '#fff', padding: '0 16px', height: 48, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: "'Roboto', sans-serif", whiteSpace: 'nowrap' }}
                  onClick={stopShare} title="Stop sharing"
                >
                  <MonitorOff size={16} /> Stop Sharing
                </button>
              )}

              <button className="bhv-btn" style={{ ...s.controlBtn, background: '#c53030' }} onClick={leaveWithNotification} title="Leave">
                <PhoneOff size={20} />
              </button>

              {isPresenting && (
                <>
                  <div style={{ width: 1, height: 22, background: '#333' }} />
                  <button className="bhv-btn" onClick={() => setOverlayMode('minimized')} style={s.controlBtn} title="Minimise controls"><Minus size={18} /></button>
                  <button className="bhv-btn" onClick={() => setOverlayMode('hidden')} style={s.controlBtn} title="Hide from presentation screen"><EyeOff size={18} /></button>
                </>
              )}
            </div>
            </>
          ) : null}
        </div>

        {/* Chat Sidebar */}
        {showChat && (
          <div style={s.sidebar}>
            <div style={s.sidebarTitle}>Chat</div>

            {/* ── DM wallet cards ─────────────────────────────────── */}
            {openDms.size > 0 && (() => {
              const DM_COLORS = ['#5b5ef4','#f5a623','#48bb78','#ed64a6','#9f7aea','#4299e1']
              const dmColor = (name: string) => DM_COLORS[name.charCodeAt(0) % DM_COLORS.length]
              const initials = (name: string) => name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
              return (
                <div style={{ borderBottom: '1px solid #1e1e1e', display: 'flex', flexDirection: 'column', gap: 0 }}>
                  {[...openDms].map(peer => {
                    const isExpanded = expandedDms.has(peer)
                    const hasUnread = dmUnread.has(peer)
                    const color = dmColor(peer)
                    const thread = messages.filter(m => {
                      if (!m.message.startsWith('__DM__')) return false
                      try {
                        const d = JSON.parse(m.message.slice(6))
                        return (d.from === displayName && d.to === peer) || (d.from === peer && d.to === displayName)
                      } catch { return false }
                    })
                    const lastMsg = thread[thread.length - 1]
                    const lastPreview = lastMsg ? (() => { try { return JSON.parse(lastMsg.message.slice(6)).text } catch { return '' } })() : ''

                    return (
                      <div key={peer} style={{ borderLeft: `3px solid ${color}`, background: '#0e0e0e', marginBottom: 1 }}>
                        {/* Card header — always visible */}
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', cursor: 'pointer', userSelect: 'none' as const }}
                          onClick={() => toggleDm(peer)}
                        >
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#000', flexShrink: 0, fontFamily: "'Roboto', sans-serif" }}>
                            {initials(peer)}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: '#ddd', fontSize: 12, fontWeight: 600, fontFamily: "'Roboto', sans-serif" }}>{peer}</span>
                              {hasUnread && <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />}
                            </div>
                            {!isExpanded && lastPreview && (
                              <span style={{ color: '#555', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, display: 'block' }}>{lastPreview}</span>
                            )}
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); closeDm(peer) }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#444', display: 'flex', padding: 2 }}
                          >
                            <X size={12} />
                          </button>
                        </div>

                        {/* Expanded thread */}
                        {isExpanded && (
                          <>
                            <div style={{ maxHeight: 180, overflowY: 'auto' as const, padding: '0 12px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {thread.length === 0 && (
                                <p style={{ color: '#444', fontSize: 12, textAlign: 'center', margin: '8px 0' }}>Start the conversation</p>
                              )}
                              {thread.map(m => {
                                let d: { from: string; text: string } | null = null
                                try { d = JSON.parse(m.message.slice(6)) } catch { return null }
                                if (!d) return null
                                const isMine = d.from === displayName
                                return (
                                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMine ? 'flex-end' : 'flex-start', gap: 2 }}>
                                    <div style={{ background: isMine ? color : '#1e1e1e', color: isMine ? '#000' : '#ddd', borderRadius: isMine ? '12px 12px 2px 12px' : '12px 12px 12px 2px', padding: '6px 10px', fontSize: 12, maxWidth: '85%', lineHeight: 1.4, fontFamily: "'Roboto', sans-serif" }}>
                                      {d.text}
                                    </div>
                                    <span style={{ color: '#444', fontSize: 10 }}>
                                      {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  </div>
                                )
                              })}
                            </div>
                            <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderTop: '1px solid #1a1a1a' }}>
                              <input
                                style={{ flex: 1, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#fff', fontSize: 12, padding: '6px 10px', outline: 'none', fontFamily: "'Roboto', sans-serif" }}
                                placeholder={`Message ${peer}…`}
                                value={dmInputs[peer] || ''}
                                onChange={e => setDmInputs(prev => ({ ...prev, [peer]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && sendDm(peer)}
                              />
                              <button
                                onClick={() => sendDm(peer)}
                                style={{ background: color, color: '#000', border: 'none', borderRadius: 8, width: 30, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              >↑</button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* ── Group chat ──────────────────────────────────────── */}
            <div style={s.messages}>
              {messages.filter(m => !m.message.startsWith('__DM__')).length === 0 && openDms.size === 0 && (
                <p style={{ color: '#555', fontSize: 13, textAlign: 'center', marginTop: 20 }}>
                  No messages yet
                </p>
              )}
              {messages.map(m => {
                if (m.message.startsWith('__DM__')) return null
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
                placeholder="Message everyone…"
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

      {/* File Modal */}
      {pendingFile && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 28, width: 400, display: 'flex', flexDirection: 'column', gap: 20 }}>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 400, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5 }}>
                {fileMode === 'present' ? 'Present File' : 'Share File'}
              </span>
              <button style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', display: 'flex' }} onClick={() => { window.electronAPI?.stopFloating(); setPendingFile(null); setPresentStep('idle'); setPresentQueue([]) }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '12px 14px' }}>
              <span style={{ fontSize: 28 }}>{fileIcon(pendingFile.type)}</span>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ color: '#ddd', fontSize: 13, fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{pendingFile.name}</div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{formatBytes(pendingFile.size)}</div>
              </div>
            </div>

            {fileMode === 'present' ? (
              <>
                {presentStep === 'waiting' ? (
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
                    {pendingSource ? (
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
                      <>
                        <p style={{ color: '#f5a623', fontSize: 13, fontWeight: 600, fontFamily: "'Roboto', sans-serif", margin: 0 }}>
                          {presentAppName} is opening…
                        </p>
                        <p style={{ color: '#aaa', fontSize: 13, fontFamily: "'Roboto', sans-serif", fontWeight: 300, margin: '0 0 4px', lineHeight: 1.7 }}>
                          Enter <strong style={{ color: '#fff' }}>Presentation / Slideshow mode</strong> in {presentAppName}, then click <strong style={{ color: '#f5a623' }}>Share</strong> next to it.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: '8px 10px' }}>
                            <span style={{ fontSize: 16, flexShrink: 0 }}>📄</span>
                            <span style={{ flex: 1, color: '#ddd', fontSize: 12, fontFamily: "'Roboto', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{pendingFile.name}</span>
                            <button
                              disabled={detectingWindow}
                              style={{ background: detectingWindow ? '#555' : '#f5a623', border: 'none', borderRadius: 7, color: detectingWindow ? '#999' : '#000', padding: '5px 12px', fontSize: 11, fontWeight: 700, cursor: detectingWindow ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                              onClick={sharePresentationWindow}
                            >{detectingWindow ? '…' : 'Share'}</button>
                          </div>

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
                          onClick={() => { window.electronAPI?.stopFloating(); setPendingFile(null); setPresentStep('idle'); setPresentQueue([]) }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                ) : (
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
        <ElectronWindowPicker
          sources={desktopSources}
          onConfirm={async src => {
            setShowWindowPicker(false)
            if (pendingFile) {
              setPendingSource({ id: src.id, name: src.name, thumbnail: src.thumbnail })
            } else {
              await shareDesktopSource(src.id, false, src.name)
            }
          }}
          onClose={() => setShowWindowPicker(false)}
          onRefresh={async () => {
            const sources = await window.electronAPI!.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
            setDesktopSources(sources)
          }}
        />
      )}

      {showInviteModal && (
        <InviteModal
          roomId={roomId}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {reactionComposer && (
        <ReactionComposer
          emoji={reactionComposer.emoji}
          defaultText={reactionComposer.text}
          anchor={reactionComposer.anchor}
          onSend={(emoji, message) => sendReaction(emoji, message || undefined)}
          onClose={() => setReactionComposer(null)}
          lastReactionAt={lastReactionAt}
          cooldownMs={REACTION_COOLDOWN_MS}
        />
      )}
    </div>
  )
}
