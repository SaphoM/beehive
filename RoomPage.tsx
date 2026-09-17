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
      openMediaPrivacySettings?: (kind: 'camera' | 'microphone' | 'screen') => Promise<boolean>
      presentationControl: (direction: 'next' | 'prev') => Promise<boolean>
      stopPresentation?: () => Promise<boolean>
      toggleFullscreen: () => Promise<boolean>
      getFullscreen: () => Promise<boolean>
      onFullscreenChange: (cb: (v: boolean) => void) => () => void
      // Bring the shared window's owning app to the foreground (native OS window
      // activation — no input injection, no Accessibility permission needed).
      // windowId is the CGWindowNumber parsed from the desktopCapturer source id.
      activateSharedWindow?: (windowId: number) => Promise<{ ok: boolean; reason?: string }>
      // Floating Control Dock — always-on-top window with core meeting controls,
      // shown while presenting a window share.
      showDock?: () => void
      hideDock?: () => void
      pushDockState?: (state: DockState) => void
      onDockAction?: (cb: (action: DockAction) => void) => () => void
      // Auto-update (electron/updater.cjs, exposed by preload.cjs). These were
      // added to the preload in v1.0.248 but never to this declaration, so
      // every call site was untyped and tsc reported them as non-existent.
      // All optional: the web build has no electronAPI at all, and every
      // caller already guards with `?.`.
      onUpdateStatus?: (cb: (data: unknown) => void) => () => void
      getAppVersion?: () => Promise<string>
      downloadUpdate?: () => Promise<unknown>
      installUpdate?: () => Promise<unknown>
      checkForUpdates?: () => Promise<unknown>
      dismissUpdate?: () => void
      setMeetingActive?: (active: boolean) => void
    }
  }
}

interface DockState {
  micOn: boolean
  camOn: boolean
  handRaised: boolean
  chatUnread: number
  participantCount: number
  speakingName: string | null
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown'
  shareLabel: string
  shareElapsed: string
  meetingElapsed: string
  canControlSlides: boolean
  // First names of OTHER participants with raised hands — the presenter's own
  // hand already shows as the dock's hand-button active state.
  raisedHandNames: string[]
}
type DockAction =
  | { type: 'toggle-mic' | 'toggle-cam' | 'toggle-hand' | 'stop-share' | 'leave' | 'open-chat' | 'open-participants' }
declare global { interface File { path?: string } }

import { PhoneOff, Link, Film, Hand, MessageSquare, X, Monitor, MonitorOff, Aperture, Crosshair, Users, Layers, Paperclip, Download, EyeOff, Minus, Maximize2, Minimize2, ExternalLink, ChevronLeft, ChevronRight, Smile, Volume2, VolumeX, MousePointer2, ClipboardList, DoorOpen, Mic } from 'lucide-react'
import {
  LiveKitRoom,
  GridLayout,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
  useLocalParticipant,
  useRoomContext,
  useDataChannel,
  TrackToggle,
  useParticipants as useLiveKitParticipants,
} from '@livekit/components-react'
import { Track, LocalVideoTrack, ParticipantEvent, ConnectionState, type Room, type LocalTrackPublication, type LocalAudioTrack } from 'livekit-client'
// Krisp ships a multi-MB WASM/ML payload — loaded lazily (see the noise-filter
// effect below) so it never bloats the initial page load for users who haven't
// published a mic track yet.
import '@livekit/components-styles'
import {
  useCreateRoom,
  useJoinRoom,
  ENDED_MEETING_ERROR,
  useAdmissionRequests,
  useChat,
  useRecordings,
  useRoomInfo,
  useAuth,
  useProfile,
  supabase,
} from './livekit_react_hooks'

import { Lobby } from './components/Lobby'
import { WaitingRoom } from './components/WaitingRoom'
import { InviteModal } from './components/InviteModal'
import { ParticipantsWindow, DockedParticipantsStrip } from './components/ParticipantsWindow'
import { BackgroundMenu } from './components/BackgroundMenu'
import { useBackgrounds } from './components/useBackgrounds'
import { OpsDashboard } from './components/OpsDashboard'
import { attachMicProcessing } from './components/micProcessing'
import { AutoCamWindow } from './components/AutoCamWindow'
import { MeetingPrepWindow } from './components/MeetingPrepWindow'
import { AdmissionRequestsWindow } from './components/AdmissionRequestsWindow'
import { FullscreenHud } from './components/FullscreenHud'
import { Toast } from './components/Toast'
import { Avatar } from './components/Avatar'
import { CameraOffAvatarOverlay } from './components/CameraOffAvatarOverlay'
import { DEVICE_CHECK_CACHE_KEY } from './components/useDeviceReadiness'
import { RoomAudioCoordination } from './components/RoomAudioCoordination'
import { BotAssistant } from './components/BotAssistant'
import { PersonalNotesToggle } from './components/PersonalNotesToggle'
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
  drawVirtualScene,
  sampleAverageBrightness,
  loadMeetingPrep,
  type StoredMeetingPrep,
  STING_RED,
  type Subtext,
  canvasFilterBlurWorks,
  pyramidBlur,
  type PyramidBlurCache,
} from './components/roomUtils'
import { createSegmentationEngine } from './components/segmentation/createSegmentationEngine'
import type { SegmentationEngine } from './components/segmentation/types'

// LiveKit's own <GridLayout> picks its column/row count from a fixed table
// of {columns, rows, orientation, minWidth} definitions (@livekit/components-
// core's selectGridLayout) keyed off the *container's* current aspect ratio
// and participant count — for 2 tiles in a landscape container it should
// pick a plain 2x1 (two equal tiles side by side), but the actual container
// (main video area, minus the chat sidebar and any floating panels) doesn't
// reliably land in "landscape" by that function's simple width/height>1
// check, and its fallback layouts include entries wider than the visible
// tile count (e.g. 2x2 for anything up to 4 tiles) — which is exactly what
// produced one full-size tile plus a visibly empty grid cell, confirmed
// directly against a real screenshot. Rather than fight LiveKit's own
// adaptive layout-selection heuristic (a bigger, riskier change reaching
// into meeting/track code this fix is explicitly scoped away from), this
// overrides the CSS it emits: `auto-fit` with an explicit minmax collapses
// any grid track that has no tile in it to 0 width, so whatever count of
// tiles are actually present always evenly fills the whole area — no empty
// cells, no single tile inflating to fill leftover space, ever. `!important`
// is required because LiveKit sets `--lk-col-count`/`--lk-row-count` via
// direct DOM `style.setProperty` calls in a `useLayoutEffect`, which would
// otherwise re-win over a plain (non-!important) override on every resize.
if (typeof document !== 'undefined' && !document.getElementById('bhv-equal-grid-tiles')) {
  const style = document.createElement('style')
  style.id = 'bhv-equal-grid-tiles'
  style.textContent = `
    .lk-grid-layout {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) !important;
      grid-auto-rows: 1fr !important;
    }
    /* A tile must fill the grid cell it was allocated, in every camera state.
       In LiveKit's stock layout the tile IS the grid item, so the grid
       stretches it to the row. Here each tile sits inside a positioning
       wrapper (needed for CameraOffAvatarOverlay), so the WRAPPER is what
       the grid stretches — and .lk-participant-tile, a plain flex column with
       no height rule of its own, falls back to its content height: the
       video's natural aspect ratio when the camera is on, and 0px when it's
       off (its placeholder is position:absolute and contributes nothing).
       Measured live with two participants: cells 710px tall and 50/50 in
       both states, but the camera-off tile rendered at 0px while the
       camera-on tile rendered at 204px — which is what made a camera toggle
       look like one participant vanishing and the other taking over. With
       the tile pinned to its wrapper, camera state changes only what's
       drawn inside a box whose size never moves. Applies identically to 1,
       2 and 3+ participants, so no layout is redesigned — only the tile's
       failure to fill the space it was already given is corrected. */
    .lk-grid-layout > * > .lk-participant-tile {
      height: 100%;
    }
  `
  document.head.appendChild(style)
}

// Self-view mirroring, owned by BeeHive rather than left to LiveKit's
// heuristic. LiveKit's stylesheet mirrors the local camera only when the
// <video> carries data-lk-facing-mode="user", which it derives from the
// track's facingMode setting — present on a raw camera track, ABSENT on the
// canvas.captureStream() track the background pipeline publishes. So the
// self-view flipped between mirrored and un-mirrored depending on whether
// an effect happened to be on. These rules key on the room wrapper's
// data-bhv-mirror instead, so the local camera preview reads the same way
// in every state, and Flip is the one control that changes it. Scoped to
// source=camera: a shared screen must never be mirrored. Only the LOCAL
// participant's element is ever matched — remote tiles are untouched, and
// the published stream (what remote viewers receive) is never mirrored
// anywhere. !important because LiveKit's own facing-mode rule would
// otherwise re-mirror the un-flipped state on a raw camera track.
if (typeof document !== 'undefined' && !document.getElementById('bhv-self-view-mirror')) {
  const style = document.createElement('style')
  style.id = 'bhv-self-view-mirror'
  style.textContent = `
    [data-bhv-mirror="on"] .lk-participant-media-video[data-lk-local-participant="true"][data-lk-source="camera"] {
      transform: rotateY(180deg) !important;
    }
    [data-bhv-mirror="off"] .lk-participant-media-video[data-lk-local-participant="true"][data-lk-source="camera"] {
      transform: none !important;
    }
  `
  document.head.appendChild(style)
}

// Audience-mode gating for LiveKit's own TrackToggle buttons (mic / camera).
// The SFU already refuses an attendee's publish (no canPublish grant); this
// makes the controls SAY so instead of letting a click fail. Keyed on the
// room wrapper like the mirror attribute above, so every control bar
// variant (desktop, mobile, presenter) is covered by one rule.
if (typeof document !== 'undefined' && !document.getElementById('bhv-audience-gate')) {
  const style = document.createElement('style')
  style.id = 'bhv-audience-gate'
  style.textContent = `
    [data-bhv-audience="true"] .lk-button[data-lk-source="microphone"],
    [data-bhv-audience="true"] .lk-button[data-lk-source="camera"] {
      opacity: 0.35;
      pointer-events: none;
    }
  `
  document.head.appendChild(style)
}

// Captured HERE, synchronously, at module-evaluation time — not inside a
// useEffect. This is what makes the desktop deep-link handoff's ?room=
// actually survive: the handoff URL is
// beehive://auth/confirm?room=ID#access_token=...&type=magiclink, and
// Supabase's client (detectSessionInUrl: true, in livekit_react_hooks.tsx)
// auto-detects that hash and asynchronously cleans up the URL via
// history.replaceState once it's consumed it — independently of, and racing
// with, AuthGate's own explicit setSession() call. RoomPage only mounts once
// AuthGate resolves `user` (after that whole callback settles), so a
// useEffect reading window.location.search at mount time was reading it
// AFTER Supabase had very likely already stripped `room` from the query —
// the invite silently failed to carry through to the desktop app's room
// view, dropping the user in the lobby instead. JS guarantees every
// synchronous top-level module body across the whole import graph runs
// before the event loop yields to any microtask/timer — including whatever
// async work Supabase's detectSessionInUrl kicks off — so a plain top-level
// const here is captured before that race can even begin, regardless of
// import order.
const INITIAL_ROOM_ID_FROM_URL = new URLSearchParams(window.location.search).get('room')
// ?ops=1 opens the Operations dashboard (admin role required — the backend
// enforces it; this only picks the view).
const OPS_FROM_URL = new URLSearchParams(window.location.search).get('ops') === '1'

// Waiting-room pending-count badge, shown on the toolbar's "Waiting Room"
// button even while its panel is closed — see useAdmissionRequests.
const admissionBadgeStyle: React.CSSProperties = {
  position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16,
  borderRadius: 8, background: '#f5a623', color: '#000', fontSize: 10,
  fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: '0 3px', lineHeight: 1,
}

export default function RoomPage() {
  const { user } = useAuth()
  const { profile } = useProfile(user?.id ?? null)

  const [view, setView] = useState<'lobby' | 'room' | 'waiting'>('lobby')
  const [opsOpen, setOpsOpen] = useState(OPS_FROM_URL)
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [livekitRoomName, setLivekitRoomName] = useState<string | null>(null)
  // Human meeting name, for the window title while in a call (see the
  // document.title effect below). joinRoom already returns it as roomName.
  const [activeMeetingName, setActiveMeetingName] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState<string | null>(INITIAL_ROOM_ID_FROM_URL)
  const [subtext, setSubtext] = useState<Subtext>('Meet')
  const [showProfileSetup, setShowProfileSetup] = useState(false)
  // Set when a scheduled (waiting-room-gated) meeting's token request comes
  // back pending — `identity` is reused verbatim on the post-admission retry
  // so it lands on the same admission_requests row instead of filing a new one.
  const [waitingInfo, setWaitingInfo] = useState<{ requestId: string; identity: string } | null>(null)

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
  const { room: inviteRoom, refresh: refreshInviteRoom } = useRoomInfo(joinRoomId)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('room')
    if (roomId) setJoinRoomId(roomId)
  }, [])

  useEffect(() => {
    if (!window.electronAPI?.requestMediaPermissions) return
    window.electronAPI.requestMediaPermissions().catch(() => {})
  }, [])

  // Web / mobile browsers only show the camera-mic permission prompt when
  // getUserMedia is actually called. Tracks now start disabled, so without
  // this warm-up the prompt never appeared and the first camera toggle could
  // silently fail (or stall) on phones. Request once on entering a room,
  // release the tracks immediately — we only want the permission grant.
  useEffect(() => {
    if (view !== 'room' || window.electronAPI) return
    navigator.mediaDevices?.getUserMedia({ video: true, audio: true })
      .then(stream => stream.getTracks().forEach(t => t.stop()))
      .catch(() => { /* denied or unavailable — toggles will surface it */ })
  }, [view])

  // Notify the auto-updater whether the user is in an active meeting so it
  // can defer blocking dialogs and non-critical update downloads until after
  // the call ends.
  useEffect(() => {
    window.electronAPI?.setMeetingActive?.(view === 'room')
  }, [view])

  // Window title reflects meeting state. This is the one signal desktop
  // note-takers and generic system-audio recorders can actually read: they
  // watch foreground window titles and match a meeting-in-progress pattern
  // ("Zoom Meeting", "Meet – abc-defg-hij"). Until now the title was the
  // static "BeeHive — X Spark" in and out of a call, so nothing could tell
  // the difference. Same string on web (tab title) and desktop (Electron
  // window title) so both surfaces announce themselves identically.
  // No third-party detector can be MADE to recognise BeeHive — Fathom,
  // Otter et al. hard-code Zoom/Meet/Teams — but this costs nothing and
  // gives any title-watching or "any meeting" recorder something honest to
  // key on. Restored on leave so the lobby never looks like a live call.
  useEffect(() => {
    const base = 'BeeHive — X Spark'
    if (view === 'room') {
      document.title = activeMeetingName ? `Meeting: ${activeMeetingName} — BeeHive` : 'Meeting in progress — BeeHive'
    } else {
      document.title = base
    }
    return () => { document.title = base }
  }, [view, activeMeetingName])

  // Prewarm Krisp's noise-filter module (a multi-MB WASM/ML payload) as
  // early as the lobby, well before any mic track exists — so that when a
  // mic is later enabled, MeetingRoom's applyFilter effect only pays for
  // Krisp's own init() (WASM instantiate + audio graph setup), not the
  // network fetch/parse of the module itself. This is a latency mitigation,
  // not a structural fix: livekit-client's audioCaptureDefaults.processor
  // (the mechanism that would attach a processor before the mic track is
  // ever published, closing the race outright) was tried and reverted —
  // in the installed livekit-client version it attaches the processor
  // *before* the newly created track's AudioContext is set (LocalParticipant
  // .createTracks calls track.setAudioContext() only after createLocalTracks
  // already resolves), so LocalAudioTrack.setProcessor() always throws
  // "Audio context needs to be set on LocalAudioTrack in order to enable
  // processors" — confirmed live, see the noise-suppression audit report.
  useEffect(() => {
    import('@livekit/krisp-noise-filter').catch(() => {})
  }, [])

  const handleCreate = async () => {
    if (!displayName.trim()) return alert('Enter your name first')
    const room = await createRoom(`Meeting ${new Date().toLocaleTimeString()}`, 'X Spark')
    if (!room) return alert('Failed to create room')
    const result = await joinRoom(room.id, displayName)
    // Start Now's own createRoom() never sets requires_admission (only
    // /api/rooms/schedule does), so joinRoom can't actually return the
    // pending branch here — this check exists purely so the 'error' narrow
    // above is type-safe, not because it can happen in practice.
    if ('error' in result || 'pending' in result) return alert('error' in result ? result.error : 'Unexpected pending state')
    window.history.pushState({}, '', `?room=${room.id}`)
    setActiveRoomId(room.id)
    setLivekitRoomName(result.livekitRoomName)
    setActiveMeetingName(result.roomName ?? null)
    setToken(result.token)
    setView('room')
  }

  // Join a specific room by id — shared core of both the invite-link "Join
  // Meeting" flow and the "Start meeting now" button the host gets right
  // after scheduling (which routes them into the SCHEDULED room, the one
  // that actually holds the agenda they just set up, rather than the Start
  // Now path that creates a fresh, agenda-less room).
  const enterRoom = async (targetRoomId: string) => {
    if (!displayName.trim()) return alert('Enter your name first')
    const result = await joinRoom(targetRoomId, displayName)
    if ('pending' in result) {
      setJoinRoomId(targetRoomId)
      setWaitingInfo({ requestId: result.requestId, identity: result.identity })
      setView('waiting')
      return
    }
    if ('error' in result) {
      // The room may have ended after this invite page loaded (useRoomInfo's
      // ended_at is a one-time snapshot from mount) — joinRoom re-checks
      // freshly and reports this specific reason on the resolved value
      // itself (not the hook's separate error state, which a stale closure
      // here would read as whatever it was *before* this click), so refresh
      // the invite preview to flip straight to the "Meeting Ended" card
      // instead of a generic alert that leaves the now-stale Join button right there.
      if (result.error === ENDED_MEETING_ERROR) { setJoinRoomId(targetRoomId); refreshInviteRoom(); return }
      return alert(result.error)
    }
    window.history.pushState({}, '', `?room=${targetRoomId}`)
    setActiveRoomId(targetRoomId)
    setLivekitRoomName(result.livekitRoomName)
    setActiveMeetingName(result.roomName ?? null)
    setToken(result.token)
    setView('room')
  }

  const handleJoin = async () => {
    if (!joinRoomId) return
    await enterRoom(joinRoomId)
  }

  // The host presses "Start meeting now" in the Schedule tab right after
  // creating the room — they hold the room's hostSecret (saved to
  // localStorage by useScheduleRoom during creation), so joinRoom admits
  // them immediately rather than into the waiting room, and they land in
  // the scheduled room with its seeded agenda already present.
  const handleStartScheduled = async (scheduledRoomId: string) => {
    await enterRoom(scheduledRoomId)
  }

  // Called by WaitingRoom the instant the host/co-host admits this attendee —
  // retries with the exact same identity so it resolves the already-admitted
  // admission_requests row instead of filing a new pending one.
  const handleAdmitted = async () => {
    if (!joinRoomId || !waitingInfo) return
    const result = await joinRoom(joinRoomId, displayName, waitingInfo.identity)
    if ('pending' in result || 'error' in result) {
      // Shouldn't happen right after being admitted, but fall back to the
      // lobby rather than getting stuck on a waiting screen that will never
      // resolve if it somehow does.
      setWaitingInfo(null)
      setView('lobby')
      if ('error' in result) alert(result.error)
      return
    }
    setWaitingInfo(null)
    setActiveRoomId(joinRoomId)
    setLivekitRoomName(result.livekitRoomName)
    setActiveMeetingName(result.roomName ?? null)
    setToken(result.token)
    setView('room')
  }

  const handleWaitingDenied = () => {
    setWaitingInfo(null)
    setView('lobby')
  }

  const handleLeave = () => {
    window.history.pushState({}, '', '/')
    setView('lobby')
    setActiveRoomId(null)
    setLivekitRoomName(null)
    setActiveMeetingName(null)
    setToken(null)
    // Prompt unauthenticated users (frictionless room join) to register after the meeting
    if (!user) setShowProfileSetup(true)
  }

  if (opsOpen) {
    return <OpsDashboard onBack={() => { setOpsOpen(false); try { const u = new URL(window.location.href); u.searchParams.delete('ops'); window.history.replaceState({}, '', u.toString()) } catch { /* fine */ } }} />
  }

  if (view === 'waiting' && waitingInfo) {
    return (
      <WaitingRoom
        requestId={waitingInfo.requestId}
        roomName={inviteRoom?.name}
        subtext={subtext}
        onAdmitted={handleAdmitted}
        onDenied={handleWaitingDenied}
      />
    )
  }

  if (view === 'room' && token && activeRoomId && livekitRoomName) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={import.meta.env.VITE_LIVEKIT_URL}
        connect={true}
        // Join with mic/camera off by default; participants opt in via the
        // toggle buttons once in the room.
        video={false}
        audio={false}
        // audioCaptureDefaults merges *over* LiveKit's own baseline
        // (autoGainControl/echoCancellation/noiseSuppression/voiceIsolation
        // all already true by default — confirmed by reading livekit-client's
        // source; this app was already close to browsers' practical ceiling
        // before touching anything). channelCount: 1 is the one genuinely
        // additive, low-risk constraint on top: explicit mono capture avoids
        // stereo-channel comb-filtering/phase artifacts some hardware
        // introduces on a "stereo" mic input that's really a single voice
        // source, and this is a standard, narrow addition — not a pipeline
        // replacement. Applies to every future setMicrophoneEnabled() call
        // (mergeDefaultOptions in livekit-client), not just this initial join.
        // adaptiveStream: each viewer receives only the resolution its tiles
        // actually render at, and nothing at all for tiles that are off-page
        // or out of view. Without it (livekit-client's default) every client
        // pulled full-resolution video from every camera that was on — the
        // capacity audit put ~25 cameras at ~35 Mbps per viewer, which is
        // what capped a large room at a handful of publishers.
        // dynacast: a publisher stops encoding simulcast layers nobody is
        // subscribed to, so the sender's CPU/upload follow real demand.
        // Neither changes anything visible in a small meeting.
        options={{ audioCaptureDefaults: { channelCount: 1 }, adaptiveStream: true, dynacast: true }}
        onDisconnected={handleLeave}
        style={{ height: 'var(--vh, 100vh)' }}
      >
        <MeetingRoom
          roomId={activeRoomId}
          displayName={displayName}
          onLeave={handleLeave}
          subtext={subtext}
          userId={user?.id ?? null}
        />
        <RoomAudioRenderer />
      </LiveKitRoom>
    )
  }

  return (
    <Lobby
      displayName={displayName}
      onDisplayNameChange={setDisplayName}
      onOpenOps={() => setOpsOpen(true)}
      onCreateRoom={handleCreate}
      onJoinRoom={joinRoomId ? handleJoin : undefined}
      onStartScheduled={handleStartScheduled}
      onJoinMeeting={enterRoom}
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
// In-meeting signals — cursors, raised hands, reactions, moderation nudges —
// travel over LiveKit's data channel, not Supabase Realtime. LiveKit fans a
// message out across the SFU mesh with no per-message quota; Supabase
// broadcast counts every recipient as a message against a per-second cap,
// so one presenter's 30 fps laser pointer × 300 attendees was 9,000 msg/s —
// beyond any tier's limit, and it starved every other channel (presence,
// chat) sharing that quota. Each signal keeps the {event, payload} envelope
// it always had; only the transport changed, so the call sites below are
// untouched. Receiving uses `useDataChannel(topic, handler)`; sending goes
// straight through room.localParticipant.publishData — NOT the hook's own
// send(). That send() wraps publishData in an "isSending" observable whose
// subscriber is only wired by an effect after each render, and because the
// hook rebuilds its handler every render (the message callback is in its
// memo deps) the send() captured at render time can hit an unwired
// subscriber and reject with "Cannot read properties of undefined (reading
// 'next')" before publishData is ever reached. Seen live. publishData
// itself has no such dependency. This adapter puts the old
// channel.send({ event, payload }) shape on top of it.
const signalEncoder = new TextEncoder()
const signalDecoder = new TextDecoder()
type SignalMsg = { event: string; payload: any }
function decodeSignal(bytes: Uint8Array): SignalMsg | null {
  try { return JSON.parse(signalDecoder.decode(bytes)) } catch { return null }
}
function signalSender(
  topic: string,
  room: Room,
  reliable: boolean,
  canSend: () => boolean,
) {
  return {
    send: ({ event, payload }: { type?: string; event: string; payload: any }) => {
      // Never publish before the room is connected. This is not just
      // politeness: livekit-client caches the promise from its first
      // publisher-connection attempt (RTCEngine.ensurePublisherConnected),
      // so a publishData() issued before the peer connection exists caches
      // a REJECTION that every later send then awaits — the data channel
      // stays dead for the whole session with "PC manager is closed" even
      // once the engine is healthy. Seen live during the migration off
      // Supabase: a mount-time cursor-off signal poisoned it. A signal
      // dropped while not yet connected is harmless; a poisoned channel
      // is not.
      if (!canSend()) return
      // A failed send is dropped, but never silently: an in-meeting signal
      // that quietly stops working is undiagnosable from a user report.
      room.localParticipant
        .publishData(signalEncoder.encode(JSON.stringify({ event, payload })), { reliable, topic })
        .catch(err => console.warn(`[signals] ${topic}/${event} send failed:`, err?.message ?? err))
    },
  }
}

function MeetingRoom({ roomId, displayName, onLeave, subtext, userId }: {
  roomId: string; displayName: string; onLeave: () => void; subtext: Subtext
  // Signed-in auth id, or null for a guest — selects the background library's
  // storage backend (Supabase bucket vs. localStorage), nothing else.
  userId: string | null
}) {
  // Sting meetings carry the red accent through to in-room controls
  const accent = subtext === 'Sting' ? STING_RED : '#f5a623'
  const [showInviteModal, setShowInviteModal] = useState(false)
  // withPlaceholder keeps a name/avatar tile in the grid for participants whose
  // camera is off — without it they have no tile at all, and since tracks now
  // start disabled the whole grid rendered as a blank black area on join.
  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  )
  const { localParticipant } = useLocalParticipant()
  const liveKitParticipants = useLiveKitParticipants()
  const room = useRoomContext()

  // Background-noise suppression on the mic — filters ambient noise and
  // isolates the speaker's voice (Krisp, via LiveKit's official track
  // processor). Applied automatically to every mic track this participant
  // publishes, including after toggling mic off/on (which creates a new
  // track). Silently skipped where unsupported — never blocks the mic.
  // RoomPage prewarms Krisp's module as early as the lobby (see its own
  // comment) so the dynamic import below almost always resolves from cache
  // by the time this runs — closing most, though not all, of the window
  // between "mic track published" and "suppression actually attached"; see
  // the noise-suppression audit report for why a structural (zero-window)
  // fix wasn't shipped here.
  // Also stashes the raw, pre-Krisp capture (`rawMicTrack`) for
  // RoomAudioCoordination's same-room heuristic, which specifically needs
  // to see what Krisp would otherwise suppress (another person's voice
  // bleeding in acoustically) — capturing a reference here doesn't consume
  // or alter the track; Krisp gets it as normal immediately after.
  const [rawMicTrack, setRawMicTrack] = useState<MediaStreamTrack | null>(null)
  useEffect(() => {
    let cancelled = false
    const applyFilter = async (pub: LocalTrackPublication) => {
      if (pub.source !== Track.Source.Microphone) return
      const track = pub.track
      if (!track || track.kind !== Track.Kind.Audio) return
      setRawMicTrack(track.mediaStreamTrack)
      if (cancelled) return
      // One authoritative attach path — see components/micProcessing.ts for
      // the audited pipeline and why a plain Krisp attach was leaving raw
      // audio on the sender (sample-rate OverconstrainedError on Bluetooth
      // / 44.1 kHz mics, and native NS left switched off after a failed
      // init). Never throws; never blocks the mic.
      await attachMicProcessing(track as LocalAudioTrack)
    }
    const existing = localParticipant.getTrackPublication(Track.Source.Microphone)
    if (existing) applyFilter(existing as LocalTrackPublication)
    localParticipant.on(ParticipantEvent.LocalTrackPublished, applyFilter)
    const clearRawTrack = (pub: LocalTrackPublication) => { if (pub.source === Track.Source.Microphone) setRawMicTrack(null) }
    localParticipant.on(ParticipantEvent.LocalTrackUnpublished, clearRawTrack)
    return () => {
      cancelled = true
      localParticipant.off(ParticipantEvent.LocalTrackPublished, applyFilter)
      localParticipant.off(ParticipantEvent.LocalTrackUnpublished, clearRawTrack)
    }
  }, [localParticipant])

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

  // Presence — role and avatar — now come from LiveKit participant
  // attributes, stamped by the backend at token time (role: host/co-host/
  // participant; avatar_url for signed-in users) and pushed live by
  // /grant-co-host. The previous source was a Supabase room_participants
  // subscription that refetched the whole roster (plus a profiles join) on
  // EVERY join/leave in EVERY client — N²/2 refetches, ~90,000 queries at
  // 300 attendees, all during the join burst. liveKitParticipants is the
  // roster this component already trusts everywhere else, and its hook
  // re-renders on ParticipantAttributesChanged, so a live role change is
  // reflected without any extra subscription.
  //
  // My own role is read off localParticipant, with an explicit listener:
  // useLocalParticipant() doesn't re-render on attribute changes by itself,
  // and a co-host grant arriving mid-meeting must flip canAdmit at once.
  const [myRole, setMyRole] = useState<string>(() => localParticipant.attributes?.role ?? 'participant')
  useEffect(() => {
    const sync = () => setMyRole(localParticipant.attributes?.role ?? 'participant')
    sync()
    localParticipant.on(ParticipantEvent.AttributesChanged, sync)
    return () => { localParticipant.off(ParticipantEvent.AttributesChanged, sync) }
  }, [localParticipant])
  // Keyed by display name, matching how every other per-participant lookup
  // in this file already works (the LiveKit identity is a random per-
  // connection UUID; the name is what's stable and human-meaningful).
  const avatarUrlFor = (name: string) => liveKitParticipants.find(p => p.name === name)?.attributes?.avatar_url ?? null
  const canAdmit = myRole === 'host' || myRole === 'co-host'

  // Audience mode: whether I may publish at all. LiveKit enforces this at
  // the SFU from the token grant (see /api/livekit/token); this mirrors it
  // for the UI so an attendee's mic / camera / share controls read as
  // "audience" instead of failing on click. Flips live when a host promotes
  // me to speaker (ParticipantPermissionsChanged), with a prompt so I know
  // the floor is mine.
  const [canPublish, setCanPublish] = useState<boolean>(() => localParticipant.permissions?.canPublish !== false)
  const [floorGranted, setFloorGranted] = useState(false)
  useEffect(() => {
    const sync = () => {
      const next = localParticipant.permissions?.canPublish !== false
      setCanPublish(prev => { if (!prev && next) setFloorGranted(true); return next })
    }
    sync()
    localParticipant.on(ParticipantEvent.ParticipantPermissionsChanged, sync)
    return () => { localParticipant.off(ParticipantEvent.ParticipantPermissionsChanged, sync) }
  }, [localParticipant])
  const isAudience = !canPublish
  // Kept subscribed for the whole session whenever canAdmit — not just while
  // the waiting-room panel happens to be open. Before this, the host had no
  // way to learn anyone was waiting short of manually opening that panel
  // (AdmissionRequestsWindow only subscribed while mounted): no badge, no
  // notification, nothing — the exact regression this fixes. See
  // useAdmissionRequests in livekit_react_hooks.tsx.
  const pendingAdmissions = useAdmissionRequests(roomId, canAdmit)
  // Fires once per newly-seen pending request id, so a host who already has
  // the panel open (and is thus reading requests straight off the list)
  // doesn't also get a redundant toast for the same person.
  const seenAdmissionIdsRef = useRef<Set<string>>(new Set())
  // The request id(s) the currently-shown toast refers to — tracked so the
  // toast can be dismissed the instant every one of them is resolved
  // (admitted or denied), rather than sitting for its full duration after
  // the host has already acted (e.g. admitting from the panel directly).
  const admissionToastIdsRef = useRef<string[]>([])
  const [admissionToast, setAdmissionToast] = useState<string | null>(null)
  useEffect(() => {
    if (!canAdmit) { seenAdmissionIdsRef.current = new Set(); return }
    const pendingIds = new Set(pendingAdmissions.map(r => r.id))
    const seen = seenAdmissionIdsRef.current
    const fresh = pendingAdmissions.filter(r => !seen.has(r.id))
    if (fresh.length > 0) {
      admissionToastIdsRef.current = fresh.map(r => r.id)
      setAdmissionToast(
        fresh.length === 1
          ? `${fresh[0].display_name} wants to join the meeting`
          : `${fresh.length} people want to join the meeting`
      )
    } else if (admissionToastIdsRef.current.length > 0 && admissionToastIdsRef.current.every(id => !pendingIds.has(id))) {
      // Every request this toast was about has since been admitted/denied.
      admissionToastIdsRef.current = []
      setAdmissionToast(null)
    }
    for (const r of pendingAdmissions) seen.add(r.id)
  }, [pendingAdmissions, canAdmit])
  // Only the room's actual creator holds this — set once in useScheduleRoom
  // at scheduling time, on that one device. A co-host can admit/deny but has
  // no secret, matching the backend's "delegation itself is host-only" rule.
  const [myHostSecret] = useState<string | null>(() => {
    try { return localStorage.getItem(`beehive:hostSecret:${roomId}`) } catch { return null }
  })
  const [showAdmissionRequests, setShowAdmissionRequests] = useState(false)
  const { messages, sendMessage } = useChat(roomId)
  const recordings = useRecordings(roomId)
  const [chatInput, setChatInput] = useState('')
  // Closed by default now that the panel floats over the video rather than
  // sitting beside it — opening over the grid on every join would cover the
  // right-hand tiles. The reopen chip is always one click away.
  const [showChat, setShowChat] = useState(false)
  // Docked (fixed side column beside the video) vs floating (overlay over
  // it). Same panel, two positions — mirrors participantsDocked below.
  // Remembered per device: someone who always wants chat docked shouldn't
  // have to re-dock it every meeting.
  const [chatDocked, setChatDocked] = useState(() => {
    try { return localStorage.getItem('beehive:chatDocked') === '1' } catch { return false }
  })
  const toggleChatDocked = useCallback(() => {
    setChatDocked(d => {
      const next = !d
      try { localStorage.setItem('beehive:chatDocked', next ? '1' : '0') } catch { /* best-effort */ }
      return next
    })
  }, [])
  const [showParticipants, setShowParticipants] = useState(false)
  const [participantsDocked, setParticipantsDocked] = useState(false)
  // Meeting-prep checklist/agenda picked back at scheduling time (if any) —
  // loaded once per room, since it's set once at scheduling and only ever
  // edited from within this same window (MeetingPrepWindow writes back to
  // the same localStorage entry directly, so no need to re-read after that).
  const [meetingPrep, setMeetingPrep] = useState<StoredMeetingPrep | null>(null)
  const [showMeetingPrep, setShowMeetingPrep] = useState(false)
  useEffect(() => { setMeetingPrep(loadMeetingPrep(roomId)) }, [roomId])

  // TrackToggle (mic/camera) fails silently by default — if setMicrophoneEnabled
  // rejects (no device, OS permission denied, device already in use by another
  // app), the button just stays in its old state with no error shown anywhere,
  // which looks exactly like "the button doesn't work" with no way to diagnose
  // it from a bug report. onDeviceError below makes that failure visible.
  const [deviceErrorToast, setDeviceErrorToast] = useState<string | null>(null)
  // Once a permission is explicitly denied, neither getUserMedia() (web) nor
  // askForMediaAccess() (Electron/macOS) can ever show that prompt again —
  // that's deliberate OS/browser security behavior, not something an app can
  // override by asking harder. The most useful thing left to do is take the
  // user straight to the exact settings screen instead of just saying
  // "blocked": Electron can deep-link to System Settings' Privacy pane
  // directly; on the web there's no equivalent cross-browser deep link, so
  // the toast points at the address-bar permission icon instead.
  const handleDeviceError = useCallback((kind: 'camera' | 'microphone', error: Error) => {
    console.error(`[${kind}] setEnabled failed:`, error)
    if (error.name === 'NotAllowedError') {
      if (window.electronAPI?.openMediaPrivacySettings) {
        window.electronAPI.openMediaPrivacySettings(kind)
        setDeviceErrorToast(
          `${kind === 'microphone' ? 'Microphone' : 'Camera'} access is blocked. Opening System Settings — ` +
          `turn it on for BeeHive there, then relaunch the app.`
        )
      } else {
        setDeviceErrorToast(
          `${kind === 'microphone' ? 'Microphone' : 'Camera'} access is blocked — click the permission icon ` +
          `in your browser's address bar to allow it, then reload the page.`
        )
      }
      return
    }
    setDeviceErrorToast(
      error.name === 'NotFoundError'
        ? `No ${kind} found — check it's connected and not disabled.`
        : `${kind === 'microphone' ? 'Microphone' : 'Camera'} error: ${error.message || error.name}`
    )
  }, [])
  const handleMicDeviceError = useCallback((error: Error) => handleDeviceError('microphone', error), [handleDeviceError])
  const handleCameraDeviceError = useCallback((error: Error) => handleDeviceError('camera', error), [handleDeviceError])
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
  const [pendingSource, setPendingSource] = useState<{ id: string; name: string; thumbnail: string; captureId?: string; isScreen?: boolean } | null>(null)
  const [detectingWindow, setDetectingWindow] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [presentQueue, setPresentQueue] = useState<File[]>([])
  const queueInputRef = useRef<HTMLInputElement>(null)

  // Mobile responsive
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 640)
  const [isSmallPhone, setIsSmallPhone] = useState(() => window.innerWidth <= 430)

  // Height of the bottom control bar. The bar now wraps onto a second row
  // on narrow windows (see s.controlsPill), so anything anchored above it —
  // the right-edge button column: chat chip, personal notes, assistant —
  // has to lift with it or it lands on top of the wrapped buttons. The
  // bar's height is content-driven, so it can't be expressed in CSS alone;
  // one ResizeObserver on the pill is the minimal, event-driven answer (no
  // polling, no work on ordinary resizes that don't change the row count).
  // 68 is the single-row height (48px buttons + 2×10 padding), the default
  // before the observer fires.
  const [controlsBarHeight, setControlsBarHeight] = useState(68)
  useEffect(() => {
    const el = controlsBarRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const h = Math.round(entries[0]?.contentRect.height ?? 0)
      if (h > 0) setControlsBarHeight(h + 20) // +20 = pill's vertical padding
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile]) // the desktop pill only exists when !isMobile; re-attach on that flip
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

  // Phase 5 — real-time device monitor: detect headphone/mic disconnects mid-meeting
  // and surface a brief toast. No view check needed: MeetingRoom is only ever
  // mounted by RoomPage when view === 'room', so being here already means we're
  // in the meeting. (`view` lives in RoomPage's scope, not this component's.)
  useEffect(() => {
    if (!navigator?.mediaDevices) return
    let prev: MediaDeviceInfo[] = []
    const check = async () => {
      try {
        const current = await navigator.mediaDevices.enumerateDevices()
        if (prev.length > 0) {
          const prevIds = new Set(prev.map(d => d.deviceId))
          const currIds = new Set(current.map(d => d.deviceId))
          const lost = prev.filter(d => !currIds.has(d.deviceId))
          if (lost.length > 0) {
            const kinds = [...new Set(lost.map(d =>
              d.kind === 'audioinput' ? 'microphone' : d.kind === 'audiooutput' ? 'speaker' : 'camera'
            ))]
            setDeviceErrorToast(`${kinds.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' & ')} disconnected — check connections.`)
            // Attempt automatic recovery for a lost microphone specifically.
            // livekit-client's own devicechange handling (Room.
            // selectDefaultDevices) deliberately skips falling back to a
            // replacement device for audioinput on every non-Safari browser
            // (its "switch to first available device" branch explicitly
            // excludes audioinput unless isSafariBased()) — so on Chrome/
            // Edge, the overwhelming majority of Windows users, a physically
            // removed microphone is left silently pointing at a
            // now-nonexistent device with no automatic recovery at all,
            // until the user leaves and rejoins the meeting. This fills
            // exactly that gap. Best-effort: if this fails, the toast above
            // has already told the user what happened.
            if (lost.some(d => d.kind === 'audioinput') && localParticipant.isMicrophoneEnabled) {
              room?.switchActiveDevice('audioinput', 'default').catch(() => {})
            }
          }
          // New device arrived — dismiss any existing error toast
          const arrived = current.filter(d => !prevIds.has(d.deviceId))
          if (arrived.length > 0 && prev.length > 0) {
            const kinds = [...new Set(arrived.map(d =>
              d.kind === 'audioinput' ? 'microphone' : d.kind === 'audiooutput' ? 'speaker' : 'camera'
            ))]
            setDeviceErrorToast(`${kinds.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(' & ')} reconnected.`)
          }
        }
        prev = current
        // Invalidate cache so next lobby visit re-checks
        try { localStorage.removeItem(DEVICE_CHECK_CACHE_KEY) } catch { /* ok */ }
      } catch { /* ignore */ }
    }
    navigator.mediaDevices.addEventListener('devicechange', check)
    return () => navigator.mediaDevices.removeEventListener('devicechange', check)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Full-screen mode covers the header/sidebar/Participants window with a
  // fixed full-viewport overlay (see the comment above) — leaving attendees,
  // raised hands, and controls unreachable while presenting full-screen. This
  // floating HUD is mounted inside that same overlay (see mainAreaRef render
  // below) so it stays visible and usable in full-screen; it doesn't change
  // how the regular Participants window behaves outside full-screen.
  const [showFullscreenHud, setShowFullscreenHud] = useState(false)
  useEffect(() => {
    if (isFullscreen) setShowFullscreenHud(true)
  }, [isFullscreen])

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

  // Gate for every data-channel send below — see signalSender.
  const signalsReady = useCallback(() => room.state === ConnectionState.Connected, [room])

  // Lossy (reliable: false): a dropped cursor frame is replaced 33 ms later
  // by the next one; retransmitting stale pointer positions only adds lag.
  useDataChannel('cursors', msg => {
    const m = decodeSignal(msg.payload); if (!m) return
    if (m.event === 'cursor') {
      setRemoteCursors(prev => {
        const next = new Map(prev)
        next.set(m.payload.name, { x: m.payload.x, y: m.payload.y, color: m.payload.color })
        return next
      })
    } else if (m.event === 'cursor-off') {
      setRemoteCursors(prev => { const next = new Map(prev); next.delete(m.payload.name); return next })
    }
  })
  cursorChannelRef.current = signalSender('cursors', room, false, signalsReady)

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

  // Tell others to drop my cursor when the laser is switched OFF — on the
  // transition only. This used to fire on mount too (laserActive starts
  // false), which was a no-op over Supabase but, over the data channel,
  // was the very first publish of the session, issued before the room had
  // connected — see signalSender for why that must never happen.
  const laserWasActive = useRef(false)
  useEffect(() => {
    if (laserWasActive.current && !laserActive && cursorChannelRef.current) {
      cursorChannelRef.current.send({ type: 'broadcast', event: 'cursor-off', payload: { name: displayName } })
    }
    laserWasActive.current = laserActive
  }, [laserActive, displayName])

  // Raise hand — broadcast to all participants via Supabase realtime
  const [raisedHands, setRaisedHands] = useState<{ identity: string; name: string; raisedAt: number }[]>([])
  const [myHandRaised, setMyHandRaised] = useState(false)
  const handsChannelRef = useRef<any>(null)

  useDataChannel('hands', msg => {
    const m = decodeSignal(msg.payload); if (!m) return
    if (m.event === 'hand_raised') {
      setRaisedHands(prev => prev.find(h => h.identity === m.payload.identity) ? prev : [...prev, { identity: m.payload.identity, name: m.payload.name, raisedAt: m.payload.raisedAt }])
    } else if (m.event === 'hand_lowered') {
      setRaisedHands(prev => prev.filter(h => h.identity !== m.payload.identity))
    } else if (m.event === 'all_hands_lowered') {
      setRaisedHands([])
      setMyHandRaised(false)
    }
  })
  handsChannelRef.current = signalSender('hands', room, true, signalsReady)

  // Stale-hand cleanup — raisedHands above is a plain ephemeral broadcast
  // with no awareness of its own of whether the participant it names is
  // still actually in the room: it only ever shrinks when that exact
  // participant's own client sends hand_lowered (toggleRaiseHand/
  // dismissHand below), or a host calls lowerAllHands. leaveWithNotification
  // never sends hand_lowered, and a crash/force-quit/lost-network departure
  // can't send anything at all — so a raised hand was orphaned on every
  // other participant's screen whenever someone left without explicitly
  // lowering it first, not just on ungraceful exits.
  // liveKitParticipants (useParticipants()) is the authoritative, already-
  // relied-upon presence source this app already trusts for the live
  // participant count elsewhere — populated from LiveKit's own real
  // ParticipantConnected/Disconnected roster events, not raw track state,
  // so it doesn't flicker on a brief reconnect the way inferring from
  // individual tracks could. Once a raised hand's owner drops out of that
  // roster, prune just that one entry — every other participant's hand is
  // untouched. Matched by name, not LiveKit's own per-connection `identity`
  // (a random UUID) — raisedHands has always kept its own `identity` field
  // as the participant's display name (see toggleRaiseHand/dismissHand),
  // which is exactly what liveKitParticipants' `.name` carries too.
  useEffect(() => {
    const activeNames = new Set(liveKitParticipants.map(p => p.name))
    setRaisedHands(prev => prev.filter(h => activeNames.has(h.identity)))
  }, [liveKitParticipants])

  // Moderation nudges — currently just "please unmute yourself" requests.
  // LiveKit has no server-side force-*unmute* primitive (mutePublishedTrack
  // is one-directional — see livekit_node_backend.js's /mute endpoint
  // comment), so a host asking someone to unmute can only ever be a request,
  // never an action performed on their behalf. Plain ephemeral broadcast,
  // same trust model as the hands channel above (advisory, not privileged —
  // authorization lives in the UI only showing the "request" control to
  // canAdmit, matching the actual mute action's own client-side gating).
  const [unmuteRequested, setUnmuteRequested] = useState(false)
  const moderationChannelRef = useRef<any>(null)
  useDataChannel('moderation', msg => {
    const m = decodeSignal(msg.payload); if (!m) return
    if (m.event === 'request_unmute' && m.payload.identity === localParticipant.identity) setUnmuteRequested(true)
  })
  moderationChannelRef.current = signalSender('moderation', room, true, signalsReady)

  const requestUnmute = (identity: string) => {
    if (!canAdmit) return
    moderationChannelRef.current?.send({ type: 'broadcast', event: 'request_unmute', payload: { identity } })
  }

  // Reactions. The old Supabase channel used self:true so the sender saw
  // their own reaction; LiveKit data messages never loop back to the sender,
  // so the sender's copy is drawn locally at send time (see the adapter).
  const showReaction = useCallback((payload: { emoji: string; message?: string; senderName?: string }) => {
    const id = reactionId.current++
    const x = Math.round((Math.random() - 0.5) * 280) // random horizontal drift -140…+140 px
    const ttl = payload.message ? 3500 : 2500
    setFloatingReactions(prev => [...prev, {
      id, emoji: payload.emoji, message: payload.message || undefined,
      senderName: payload.senderName, x,
    }])
    setTimeout(() => setFloatingReactions(prev => prev.filter(r => r.id !== id)), ttl)
  }, [])
  useDataChannel('reactions', msg => {
    const m = decodeSignal(msg.payload); if (!m) return
    if (m.event === 'reaction') showReaction(m.payload)
  })
  reactionChannelRef.current = {
    send: ({ payload }: { type?: string; event: string; payload: any }) => {
      showReaction(payload)
      signalSender('reactions', room, true, signalsReady).send({ event: 'reaction', payload })
    },
  }

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

  // Permission rule: an attendee may only ever lower their own hand; lowering
  // someone else's — or everyone's — is host/co-host only. This was
  // previously unenforced (any attendee could call either function for any
  // identity), matching neither the UI's own "host can dismiss" comment
  // above nor real moderation semantics. Client-side only, same trust model
  // as the rest of this ephemeral hand-raise feature (see the hands-channel
  // effect above — it's a plain Supabase broadcast with no row/table behind
  // it to authorize against server-side); the UI below additionally hides
  // these controls from anyone who isn't permitted to use them.
  const dismissHand = (identity: string) => {
    if (identity !== displayName && !canAdmit) return
    handsChannelRef.current?.send({ type: 'broadcast', event: 'hand_lowered', payload: { identity } })
    setRaisedHands(prev => prev.filter(h => h.identity !== identity))
    if (identity === displayName) setMyHandRaised(false)
  }

  const lowerAllHands = () => {
    if (!canAdmit) return
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
  const bgStateRef = useRef({ effect: bgEffect, blurLevel, presetId: bgPresetId })
  bgStateRef.current = { effect: bgEffect, blurLevel, presetId: bgPresetId }

  // Flip no longer participates here. It used to be applied *inside* the
  // compositing canvas (ctx.scale(-1,1)), which mirrored the PUBLISHED
  // stream: it made the user look right to themselves but showed everyone
  // else a reversed image (text on a shirt backwards). The reason it ever
  // felt necessary: LiveKit mirrors your own preview via CSS only when the
  // track reports facingMode=user, and a canvas track has no facingMode —
  // so the moment any effect was on, the self-view silently stopped
  // mirroring and looked "backwards". Flip was compensating for that.
  //
  // Correct model, now implemented: the self-view is mirrored by CSS in
  // every state (effect or not), the published stream is never mirrored,
  // and Flip toggles only how you see yourself. See data-bhv-mirror on the
  // room wrapper. Flip therefore never needs the pipeline running.
  const bgActive = bgEffect !== 'none'

  // "My Backgrounds" library — a list the user picks from, not a single
  // slot. Signed in → Supabase `backgrounds` bucket (synced across devices);
  // guest → localStorage. See components/useBackgrounds.ts. The compositing
  // pipeline below is unchanged: it still reads one HTMLImageElement from
  // bgUploadedImageRef; this block just keeps that ref pointed at whichever
  // library entry is currently selected.
  const bgLibrary = useBackgrounds(userId)
  const selectedBgUrl = bgLibrary.selected?.url ?? null

  useEffect(() => {
    if (!selectedBgUrl) { bgUploadedImageRef.current = null; return }
    let cancelled = false
    const img = new Image()
    // Bucket URLs are cross-origin; without this the canvas would be
    // tainted and captureStream() would silently stop producing frames.
    // Supabase public storage serves permissive CORS headers. Data URLs
    // (guest library) are same-origin and unaffected by the attribute.
    img.crossOrigin = 'anonymous'
    img.onload = () => { if (!cancelled) bgUploadedImageRef.current = img }
    img.onerror = () => { if (!cancelled) bgUploadedImageRef.current = null }
    img.src = selectedBgUrl
    return () => { cancelled = true }
  }, [selectedBgUrl])

  // Choosing a saved background (or adding a new one, which auto-selects it)
  // is the user's way of saying "use a photo" — switch the effect to Image
  // so the pick takes effect immediately, matching the old upload behaviour.
  const handleSelectBackground = useCallback((id: string) => {
    bgLibrary.setSelectedId(id)
    setBgEffect('image')
  }, [bgLibrary])

  const handleAddBackground = useCallback(async (file: File) => {
    const added = await bgLibrary.addBackground(file)
    if (added) setBgEffect('image')
  }, [bgLibrary])

  const handleRemoveBackground = useCallback(async (id: string) => {
    const wasSelected = bgLibrary.selectedId === id
    await bgLibrary.removeBackground(id)
    // Removing the background that's currently applied leaves nothing to
    // composite, so drop back to no effect rather than a blank backdrop.
    if (wasSelected) setBgEffect(prev => (prev === 'image' ? 'none' : prev))
  }, [bgLibrary])

  // The camera track's presence must be a dependency of the pipeline effect:
  // if a background effect (or Flip) is toggled while the camera is OFF, the
  // effect body runs once, finds no track, and returns — and with deps of
  // only [bgActive, localParticipant] nothing ever re-ran it when the camera
  // came on, so background/flip silently did nothing for the rest of the
  // session (clicks looked completely dead). useLocalParticipant re-renders
  // this component on local track publish/unpublish, so deriving the
  // track's presence per render and putting it in the deps restarts the
  // pipeline the moment the camera track appears.
  const camTrackReady = !!localParticipant.getTrackPublication(Track.Source.Camera)?.track

  useEffect(() => {
    const pub = localParticipant.getTrackPublication(Track.Source.Camera)
    const lkTrack = pub?.track
    if (!lkTrack) return

    if (!bgActive) {
      if (bgOrigTrackRef.current) {
        // `replaceTrack`'s second argument (userProvidedTrack) defaults to
        // true, which tells LiveKit "the app owns this track — don't stop
        // it on unpublish/disconnect." That default is correct for the
        // canvas track below (line ~1315 — we do manage that one), but this
        // call restores the REAL camera track LiveKit itself originally
        // created via setCameraEnabled(); leaving the default here silently
        // reassigned that track's ownership away from LiveKit, so its own
        // disconnect/unpublish logic stopped stopping it. Passing `false`
        // hands ownership back, restoring the exact behavior a camera that
        // never went through a background effect already has.
        ;(lkTrack as any).replaceTrack(bgOrigTrackRef.current, false).catch(() => {})
        bgOrigTrackRef.current = null
      }
      return
    }

    const raw = (lkTrack as any).mediaStreamTrack as MediaStreamTrack | undefined
    if (!raw) return
    if (!bgOrigTrackRef.current) bgOrigTrackRef.current = raw

    // Canvas dimensions are derived from the REAL camera resolution (below) so the
    // output keeps the camera's aspect ratio — no 4:3-vs-16:9 stretching. Capped
    // to 1280 wide for performance; the MediaPipe model runs at a fixed internal
    // size regardless, so a larger canvas only costs cheap GPU draw ops.
    const MAX_W = 1280
    let W = 0, H = 0
    let running = true
    let seg: SegmentationEngine | null = null

    const video = document.createElement('video')
    video.srcObject = new MediaStream([bgOrigTrackRef.current])
    video.playsInline = true; video.muted = true

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    const offCanvas = document.createElement('canvas')     // masked attendee cutout
    const offCtx = offCanvas.getContext('2d')!
    offCtx.imageSmoothingQuality = 'high'
    const maskCanvas = document.createElement('canvas')    // raw mask + confidence ramp (getImageData each frame)
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })!
    const featherCanvas = document.createElement('canvas') // feather-blurred copy of the ramped mask
    const featherCtx = featherCanvas.getContext('2d')!
    // Temporal smoothing needs a read+write of the previous smoothed mask each
    // frame, which a canvas can't do onto itself — so ping-pong two canvases.
    let smoothFront = document.createElement('canvas')
    let smoothFrontCtx = smoothFront.getContext('2d')!
    let smoothBack = document.createElement('canvas')
    let smoothBackCtx = smoothBack.getContext('2d')!
    // Halo (nearness-to-subject falloff, for the depth-of-field blur below) and
    // the reduced-resolution "near focus" background pass that reads it.
    const haloCanvas = document.createElement('canvas')
    const haloCtx = haloCanvas.getContext('2d')!
    const bgLightCanvas = document.createElement('canvas')
    const bgLightCtx = bgLightCanvas.getContext('2d')!
    // Final alpha matte — the post-EMA smoothed mask, closed and
    // opacity-saturated (see the MATTE_* constants below). This is what the
    // subject cutout actually composites with; smoothFront stays the raw
    // smoothed mask so the EMA and the DOF halo are unaffected.
    const matteCanvas = document.createElement('canvas')
    const matteCtx = matteCanvas.getContext('2d')!
    let maskSeeded = false

    // Safari/WebKit renders `ctx.filter = 'blur(...)'` as a silent no-op (the
    // property round-trips but nothing blurs — verified against the real
    // WebKit engine), which reduced the whole Blur effect there to "sharp
    // background + hard-edged cutout". Detected once by testing what the
    // filter actually renders; when broken, every blur below goes through
    // pyramidBlur() (repeated half-res downscales — plain drawImage, works
    // everywhere) instead. Chromium/Electron keep the native path unchanged.
    const nativeBlur = canvasFilterBlurWorks()
    const blurCaches: Record<string, PyramidBlurCache> = {
      feather: { levels: [] }, halo: { levels: [] }, matte: { levels: [] },
      far: { levels: [] }, near: { levels: [] },
    }

    // A visible fake shadow around the cutout was a crutch for the old hard-
    // edged mask; the feathered + temporally-smoothed mask below shouldn't
    // need it. Left as a one-line revert switch rather than deleted outright.
    const SHOW_RIM = false

    // Subtle, capped exposure/tint nudge toward the background's average tone —
    // recomputed only when the background itself changes (not per frame).
    // Keyed on the *object identity* of the selected image (bgUploadedImageRef
    // is a ref, always live) rather than the library's selectedId state, which
    // this closure would otherwise capture stale — image/preset can change
    // while bgActive stays true, so this effect never re-runs to pick up a
    // fresh value of a plain state variable.
    let bgColorCache: { effect: string; presetId: string; img: HTMLImageElement | null; brightness: number; saturate: number } | null = null

    let trackReplaced = false

    const setupDims = () => {
      const vw = video.videoWidth || 1280, vh = video.videoHeight || 720
      const scale = Math.min(1, MAX_W / vw)
      W = Math.round(vw * scale); H = Math.round(vh * scale)
      canvas.width = W; canvas.height = H
      offCanvas.width = W; offCanvas.height = H
    }

    // Mask pipeline, per frame: confidence ramp → feather → temporal EMA.
    //
    // 1. Confidence ramp (pixel loop): MediaPipe assigns mid confidence to
    //    person-adjacent objects (pillows, chair backs). Left as-is, those
    //    render as translucent ghost blobs of the real room. A wide smoothstep
    //    ramp crushes low confidence to 0 and lifts high confidence to 1 while
    //    keeping a broad soft band in between — junk suppressed, hair/finger
    //    edges still soft (unlike the old near-binary 100–165 threshold).
    // 2. Feather: small blur so the ramped edge blends instead of cutting.
    // 3. Temporal EMA with real decay: new = α·current + (1−α)·previous, done
    //    with 'lighter' compositing (alpha channels literally add), because a
    //    plain source-over blend can NEVER decay a pixel back toward
    //    transparent — src alpha 0 leaves dst untouched — which made every
    //    transient misclassification stick on screen permanently.
    // Retuned for the Tasks Vision engine's RAW confidence distribution: the
    // legacy engine's masks arrived post-processed and near-binary, so LO=70
    // (27%) cost nothing — but raw confidences on motion-blurred hands, hair
    // wisps, and glasses legitimately sit in the 0.2–0.5 band, and the old
    // floor was amputating them (hands turning transparent mid-gesture, hair
    // edges vanishing). 45/175 keeps junk suppression below ~18% confidence
    // while letting genuine mid-confidence body pixels through the ramp.
    const RAMP_LO = 35, RAMP_HI = 175 // LO lowered from 45 with the matte
    // saturation below in place: flyaway hair / wisps sit at raw confidence
    // ~0.15–0.35, and the old floor culled the bottom of that band. Interior
    // opacity no longer depends on the ramp being conservative (the matte
    // boost guarantees it), so the floor can favor hair. Sub-0.14 junk is
    // still crushed by the smoothstep.
    const FEATHER_PX = 2 // was 3 — the matte close blur below adds ~1px of
    // post-EMA softening, so the pre-EMA feather shrinks to keep total edge
    // softness where it shipped instead of stacking into "helmet hair".
    const TEMPORAL_ALPHA = 0.65 // weight of the new frame each blend
    // Final-matte shaping, applied AFTER temporal smoothing (order matters:
    // the EMA sees the raw feathered mask, the composite sees this):
    //  • close blur — a ~1px blur before saturation acts as a morphological
    //    CLOSE: transient pinholes inside hands/arms (the "floating holes"
    //    artifact) get filled by neighboring alpha before the boost locks
    //    them opaque, and the edge gains a touch of sub-pixel smoothing.
    //  • opacity boost — matte α = min(1, (1 + MATTE_OPACITY_BOOST)·α) via a
    //    'lighter' self-composite. Raw confidences inside the torso/hands can
    //    dip to ~0.6 for a few frames, which used to render the BODY itself
    //    faintly translucent (background showing through clothing) — the
    //    boost saturates anything above ~0.67 to fully opaque, while the
    //    sub-0.5 hair band keeps graded translucency, i.e. a real alpha
    //    matte rather than a binary cutout.
    const MATTE_CLOSE_BLUR_PX = 1
    const MATTE_OPACITY_BOOST = 0.5
    const HALO_BLUR_PX = 18 // large-radius blur of the mask -> soft "nearness to subject" falloff, for the depth blur below

    // Depth-of-field blur (background effect only) — see onResults' 'blur'
    // branch. Both multipliers apply to the user's existing 2-20 blurLevel
    // slider, so its range/meaning to the user is unchanged.
    const NEAR_MULT = 0.6  // background right around the subject stays relatively sharp
    const FAR_MULT = 1.5   // background far from the subject gets noticeably softer
    const BG_WORK_SCALE = 0.5 // reduced working resolution for the near-focus pass (cheap; blur has no fine detail to lose)

    // Subtle global contrast lift on the subject layer ("portrait pop") — a
    // flat multiplicative contrast, not true local/spatial unsharp masking
    // (Canvas 2D has no native signed-subtraction blend mode; a real unsharp
    // mask would need a per-pixel loop, which conflicts with this pipeline's
    // performance-first design). Cheap: chains onto a filter string already
    // being applied, not an extra pass.
    const FOREGROUND_CONTRAST = 1.05

    const processMask = (mask: any) => {
      const nw = mask.width || 256, nh = mask.height || 256
      // 512 matches the Tasks Vision adapter's SEG_INPUT_W exactly, so its
      // mask passes through 1:1 with no wasteful near-identity resample;
      // the legacy engine's input-resolution masks downscale to it as before.
      const mw = Math.min(512, nw), mh = Math.round(mw * nh / nw)
      for (const c of [maskCanvas, featherCanvas, smoothFront, smoothBack, haloCanvas, matteCanvas]) {
        if (c.width !== mw || c.height !== mh) {
          c.width = mw; c.height = mh
          maskSeeded = false // resized — old smoothed contents no longer match
        }
      }

      maskCtx.clearRect(0, 0, mw, mh)
      maskCtx.drawImage(mask, 0, 0, mw, mh)
      try {
        const id = maskCtx.getImageData(0, 0, mw, mh)
        const d = id.data
        for (let i = 3; i < d.length; i += 4) {
          const a = d[i]
          if (a <= RAMP_LO) d[i] = 0
          else if (a >= RAMP_HI) d[i] = 255
          else {
            const t = (a - RAMP_LO) / (RAMP_HI - RAMP_LO)
            d[i] = Math.round(t * t * (3 - 2 * t) * 255) // smoothstep, not linear
          }
        }
        maskCtx.putImageData(id, 0, 0)
      } catch { /* tainted/unsupported — soft mask already drawn is the fallback */ }

      featherCtx.clearRect(0, 0, mw, mh)
      if (nativeBlur) {
        featherCtx.filter = `blur(${FEATHER_PX}px)`
        featherCtx.drawImage(maskCanvas, 0, 0)
        featherCtx.filter = 'none'
      } else {
        const b = pyramidBlur(blurCaches.feather, maskCanvas, mw, mh, FEATHER_PX)
        if (b) featherCtx.drawImage(b.canvas, 0, 0, b.w, b.h, 0, 0, mw, mh)
        else featherCtx.drawImage(maskCanvas, 0, 0)
      }

      if (!maskSeeded) {
        smoothFrontCtx.clearRect(0, 0, mw, mh)
        smoothFrontCtx.drawImage(featherCanvas, 0, 0)
        maskSeeded = true
      } else {
        // back = (1−α)·front + α·feather, exactly — then swap front/back.
        smoothBackCtx.globalCompositeOperation = 'source-over'
        smoothBackCtx.clearRect(0, 0, mw, mh)
        smoothBackCtx.globalAlpha = 1 - TEMPORAL_ALPHA
        smoothBackCtx.drawImage(smoothFront, 0, 0)
        smoothBackCtx.globalCompositeOperation = 'lighter'
        smoothBackCtx.globalAlpha = TEMPORAL_ALPHA
        smoothBackCtx.drawImage(featherCanvas, 0, 0)
        smoothBackCtx.globalCompositeOperation = 'source-over'
        smoothBackCtx.globalAlpha = 1
        ;[smoothFront, smoothBack] = [smoothBack, smoothFront]
        ;[smoothFrontCtx, smoothBackCtx] = [smoothBackCtx, smoothFrontCtx]
      }

      // Derive the depth-of-field "nearness" halo from the final smoothed mask
      // itself (not a separate computation) — guarantees pixel-perfect alignment
      // with the actual subject silhouette, since it IS that silhouette, just
      // blurred far more broadly. A large blur of a mostly-binary shape yields a
      // smooth radial falloff outward from the shape boundary.
      haloCtx.clearRect(0, 0, mw, mh)
      if (nativeBlur) {
        haloCtx.filter = `blur(${HALO_BLUR_PX}px)`
        haloCtx.drawImage(smoothFront, 0, 0)
        haloCtx.filter = 'none'
      } else {
        const b = pyramidBlur(blurCaches.halo, smoothFront, mw, mh, HALO_BLUR_PX)
        if (b) haloCtx.drawImage(b.canvas, 0, 0, b.w, b.h, 0, 0, mw, mh)
        else haloCtx.drawImage(smoothFront, 0, 0)
      }

      // Final matte: close (blur fills pinholes / sub-pixel-smooths the
      // edge), then saturate opacity via 'lighter' self-add — see the
      // MATTE_* constants above. Two small GPU draws, no readback.
      matteCtx.clearRect(0, 0, mw, mh)
      if (nativeBlur) {
        matteCtx.filter = `blur(${MATTE_CLOSE_BLUR_PX}px)`
        matteCtx.drawImage(smoothFront, 0, 0)
        matteCtx.filter = 'none'
      } else {
        const b = pyramidBlur(blurCaches.matte, smoothFront, mw, mh, MATTE_CLOSE_BLUR_PX)
        if (b) matteCtx.drawImage(b.canvas, 0, 0, b.w, b.h, 0, 0, mw, mh)
        else matteCtx.drawImage(smoothFront, 0, 0)
      }
      matteCtx.globalCompositeOperation = 'lighter'
      matteCtx.globalAlpha = MATTE_OPACITY_BOOST
      matteCtx.drawImage(matteCanvas, 0, 0)
      matteCtx.globalCompositeOperation = 'source-over'
      matteCtx.globalAlpha = 1

      return matteCanvas
    }

    // Receives the mask itself — the SegmentationEngine interface already
    // unwraps each engine's native result shape (legacyEngine passes
    // results.segmentationMask, tasksVisionEngine its converted canvas).
    // This callback previously kept the pre-interface signature and read
    // `results.segmentationMask` off what was already the bare mask —
    // undefined — so processMask threw on EVERY frame, on BOTH engines
    // (the circuit-breaker downgraded tasks-vision → legacy, which then
    // failed identically), and no background effect rendered at all. That
    // one stale line was the entire "virtual background regressed" outage.
    // If anything inside this callback throws, the resilience wrapper in
    // createSegmentationEngine() (components/segmentation/createSegmentationEngine.ts)
    // catches it as a "frame failed", counts it, and after 3 in a row downgrades
    // engines — but once already on the legacy engine, there's no further
    // fallback, so a callback that fails on EVERY frame (e.g. an edge case
    // specific to some real camera's resolution/aspect ratio that the fake
    // camera used for testing never triggers) fails silently, forever:
    // trackReplaced never flips true, so the raw camera keeps publishing
    // unprocessed with zero visible indication anything is wrong — reads
    // exactly like "Blur is selected but does nothing." Wrapping the whole
    // callback surfaces that failure instead of leaving it silent.
    let reportedOnResultsError = false
    const onResults = (maskInput: CanvasImageSource) => {
      if (!running || !W) return
      try {
        onResultsInner(maskInput)
      } catch (e) {
        console.error('[background-effect] onResults failed:', e)
        if (!reportedOnResultsError) {
          reportedOnResultsError = true
          setDeviceErrorToast(`Background effect error — ${(e as Error)?.message || 'unknown'}. Try a different effect or camera resolution.`)
        }
        throw e // still let the resilience wrapper count/react to this failure
      }
    }

    const onResultsInner = (maskInput: CanvasImageSource) => {
      const { effect, blurLevel: bl, presetId } = bgStateRef.current

      // Hoisted so the depth-of-field blur background pass (below) can read
      // haloCanvas, which processMask() populates as a side effect — must run
      // before the background layer, not after.
      const mask = processMask(maskInput)

      ctx.save()
      ctx.clearRect(0, 0, W, H)
      // No mirroring here, ever: this canvas IS the published stream, and
      // attendees must see the user the way a camera sees them. Self-view
      // mirroring is a CSS concern on the local <video> only (data-bhv-mirror).

      // ---- Background layer (drawn at the camera's true aspect ratio) ----
      if (effect === 'blur') {
        // Fake depth-of-field: blend a lightly-blurred "near subject" pass with
        // a heavily-blurred "far" backdrop, weighted by haloCanvas (a large blur
        // of the subject's own mask — high near the silhouette, decaying with
        // distance). No hard blur boundary, because the halo itself is a
        // continuous gradient.
        const pad = Math.max(2, bl) * 2
        const farBlur = bl * FAR_MULT
        const nearBlur = bl * NEAR_MULT

        // Far backdrop — full resolution, same overscan anti-vignette trick as before.
        if (nativeBlur) {
          ctx.filter = `blur(${farBlur}px)`
          ctx.drawImage(video, -pad, -pad, W + pad * 2, H + pad * 2)
          ctx.filter = 'none'
        } else {
          // pyramidBlur's edge sampling is clamped (drawImage), so there's no
          // transparent-edge vignette and no overscan needed. Source rect must
          // be the video's INTRINSIC size (camera can exceed the canvas cap —
          // passing W,H would crop, not scale).
          const b = pyramidBlur(blurCaches.far, video, video.videoWidth || W, video.videoHeight || H, farBlur)
          if (b) ctx.drawImage(b.canvas, 0, 0, b.w, b.h, 0, 0, W, H)
          else ctx.drawImage(video, 0, 0, W, H)
        }

        // Near-focus pass — reduced working resolution (blur destroys detail
        // anyway, so downscale-before-blur/upscale-after is visually lossless
        // while cutting this pass's pixel cost to ~BG_WORK_SCALE^2).
        const lw = Math.max(1, Math.round(W * BG_WORK_SCALE))
        const lh = Math.max(1, Math.round(H * BG_WORK_SCALE))
        if (bgLightCanvas.width !== lw || bgLightCanvas.height !== lh) {
          bgLightCanvas.width = lw; bgLightCanvas.height = lh
        }
        // The overscan pad must scale down with the reduced resolution too —
        // skipping this leaves a vignette-darkened rim wherever the halo lets
        // the near pass show through.
        const lpad = Math.max(2, nearBlur) * 2 * BG_WORK_SCALE
        bgLightCtx.clearRect(0, 0, lw, lh)
        if (nativeBlur) {
          bgLightCtx.filter = `blur(${nearBlur * BG_WORK_SCALE}px)`
          bgLightCtx.drawImage(video, -lpad, -lpad, lw + lpad * 2, lh + lpad * 2)
          bgLightCtx.filter = 'none'
        } else {
          // Intrinsic source size here too (see the far-pass note above); the
          // radius still uses the reduced-res scale factor since the OUTPUT
          // is the lw×lh working canvas.
          const b = pyramidBlur(blurCaches.near, video, video.videoWidth || lw, video.videoHeight || lh, nearBlur * BG_WORK_SCALE)
          if (b) bgLightCtx.drawImage(b.canvas, 0, 0, b.w, b.h, 0, 0, lw, lh)
          else bgLightCtx.drawImage(video, 0, 0, lw, lh)
        }
        bgLightCtx.globalCompositeOperation = 'destination-in'
        bgLightCtx.drawImage(haloCanvas, 0, 0, lw, lh) // halo stretched to near-pass resolution — same stretch pattern as mask -> offCanvas
        bgLightCtx.globalCompositeOperation = 'source-over'

        ctx.drawImage(bgLightCanvas, 0, 0, W, H) // upscale onto the far backdrop already on ctx
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

      // ---- Subtle color match: nudge the subject toward the background's tone ----
      // Recomputed only when the background actually changes (cached, keyed on
      // the live image ref rather than any closure-captured state — see note
      // on bgColorCache above), so this costs nothing on the other ~29 frames
      // out of 30 each second.
      const currentImg = bgUploadedImageRef.current
      const bgChanged = bgColorCache?.effect !== effect || bgColorCache?.presetId !== presetId || bgColorCache?.img !== currentImg
      if (effect !== 'none' && bgChanged) {
        const bgBrightness = sampleAverageBrightness(canvas)
        // 0.5 (mid-grey) is neutral — deviation from it drives a small, capped nudge.
        const delta = bgBrightness - 0.5
        bgColorCache = {
          effect, presetId, img: currentImg,
          brightness: Math.min(1.08, Math.max(0.92, 1 + delta * 0.16)),
          saturate: Math.min(1.05, Math.max(0.95, 1 + delta * 0.1)),
        }
      }

      // ---- Attendee layer (feathered, temporally-smoothed cutout) ----
      if (effect !== 'none') {
        offCtx.clearRect(0, 0, W, H)
        // Subtle global contrast lift ("portrait pop") stacks with the
        // background-tone nudge when present, or applies alone otherwise —
        // covers every case that reaches this layer (blur/image/virtual).
        offCtx.filter = bgColorCache
          ? `brightness(${bgColorCache.brightness}) saturate(${bgColorCache.saturate}) contrast(${FOREGROUND_CONTRAST})`
          : `contrast(${FOREGROUND_CONTRAST})`
        offCtx.drawImage(video, 0, 0, W, H)
        offCtx.filter = 'none' // must be cleared before the mask draw below — a
                                // lingering filter would blur the mask itself, not just the video
        offCtx.globalCompositeOperation = 'destination-in'
        offCtx.drawImage(mask, 0, 0, W, H)
        offCtx.globalCompositeOperation = 'source-over'
        // Optional rim — off by default; the feathered mask shouldn't need it
        // (see SHOW_RIM above). Kept as a one-line revert path.
        if (SHOW_RIM && (effect === 'image' || effect === 'virtual')) {
          ctx.shadowColor = 'rgba(0,0,0,0.45)'
          ctx.shadowBlur = Math.max(6, Math.round(W / 120))
        }
        ctx.drawImage(offCanvas, 0, 0)
        ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'
      }

      ctx.restore()

      if (!trackReplaced) {
        trackReplaced = true
        const [canvasTrack] = canvas.captureStream(30).getVideoTracks()
        ;(lkTrack as any).replaceTrack(canvasTrack).catch(() => {})
      }
    }

    const init = async () => {
      // Tries MediaPipe Tasks Vision (GPU-delegated, actively maintained)
      // first, falling back to the legacy SelfieSegmentation engine — see
      // components/segmentation/ for the abstraction. Either engine
      // implements the same SegmentationEngine shape, so nothing below this
      // line needs to know or care which one is actually active.
      seg = await createSegmentationEngine()
      if (!running) { seg.close(); return }

      seg.onResults(onResults)

      await video.play().catch(() => {})
      if (video.videoWidth) setupDims()
      else video.addEventListener('loadedmetadata', setupDims, { once: true })

      // Frame pacing: requestVideoFrameCallback fires exactly once per NEW
      // camera frame. The old requestAnimationFrame loop fired at the
      // DISPLAY's refresh rate — on a 120 Hz ProMotion Mac that segmented
      // the same 30 fps camera frame up to 4×, which (a) quadrupled
      // inference cost for nothing, and (b) ran the temporal-smoothing EMA
      // 4× per camera frame, compounding α=0.65 into an effective ~0.985 —
      // i.e. almost NO smoothing, which is exactly the mask flicker /
      // "breathing edges" this pipeline's EMA exists to prevent. It also
      // means smoothing strength silently varied with the viewer's monitor.
      // The busy flag drops frames rather than queueing them if inference
      // ever runs slower than the camera — latency stays bounded during
      // fast movement instead of building a backlog.
      let busy = false
      const processFrame = async () => {
        if (busy || video.readyState < 2) return
        busy = true
        if (!W) setupDims()
        try { await seg!.send(video) } catch {}
        busy = false
      }
      const hasRVFC = typeof (video as any).requestVideoFrameCallback === 'function'
      if (hasRVFC) {
        const onFrame = async () => {
          if (!running) return
          await processFrame()
          ;(video as any).requestVideoFrameCallback(onFrame)
        }
        ;(video as any).requestVideoFrameCallback(onFrame)
      } else {
        const sendFrame = async () => {
          if (!running) return
          await processFrame()
          if (running) requestAnimationFrame(sendFrame)
        }
        sendFrame()
      }
    }

    init().catch(e => {
      // createSegmentationEngine() falls back to the legacy engine if Tasks
      // Vision fails to init — but if THAT also throws (CDN unreachable,
      // WASM/GPU totally unsupported), this promise was never caught before,
      // so `seg` stayed unset and nothing ever ran: silent raw-camera passthrough
      // with no indication why, same failure shape as onResults throwing.
      console.error('[background-effect] init failed — segmentation unavailable:', e)
      setDeviceErrorToast(`Background effect failed to start — ${(e as Error)?.message || 'unknown error'}.`)
    })

    return () => {
      running = false
      video.srcObject = null
      try { seg?.close() } catch {}
      if (bgOrigTrackRef.current) {
        // Same ownership fix as the !bgActive branch above — this cleanup
        // runs on every unmount too (leaving the meeting while background
        // effects are active), and the missing `false` here is what left
        // the real camera's MediaStreamTrack marked "user provided," so
        // LiveKit's own disconnect logic no longer stopped it — the camera
        // LED stayed on and the track stayed live after Leave.
        ;(lkTrack as any).replaceTrack(bgOrigTrackRef.current, false).catch(() => {})
      }
    }
  }, [bgActive, localParticipant, camTrackReady])

  // Used to force the Participants window open the instant any remote
  // screen share started (so attendee cameras stayed visible while the
  // shared screen filled the main area). But `hasRemoteScreenShare` flips
  // false→true→false→true across ordinary presenter actions — switching the
  // shared window/source (ScreenShareBar's Switch button republishes the
  // track), a brief resubscribe hiccup — and each false→true edge re-ran
  // this effect and force-reopened the window even after the user had just
  // explicitly closed it via the X. That's the two symptoms reported
  // together: opens without being clicked, and "won't stay closed". The
  // Participants window now only ever opens from an explicit user action
  // (header pill, dock button, hands-chip, FullscreenHud) — removed rather
  // than gated, since any condition here could still refire unexpectedly.

  const [autoCamMode, setAutoCamMode] = useState<'center' | 'split' | null>(null)
  const [showAutoCamMenu, setShowAutoCamMenu] = useState(false)

  const [shareMenu, setShareMenu] = useState(false)
  const [isSharing, setIsSharing] = useState(false)

  // Once a share (local or remote) actually ends, auto-close the attendees
  // strip if it's open — it was most likely opened to check on people while
  // a screen dominated the main area. Safe in a way the old auto-OPEN
  // behavior wasn't (see the comment near hasRemoteScreenShare above): this
  // can only ever turn the strip off, never force it back on, so it can't
  // reproduce the "won't stay closed" bug that removal fixed.
  useEffect(() => {
    if (!isSharing && !hasRemoteScreenShare) setShowParticipants(false)
  }, [isSharing, hasRemoteScreenShare])

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

  // Click-to-focus for window shares: clicking the main-area preview brings the
  // real shared window (and its owning app) to the foreground via a native OS
  // activation call (NSRunningApplication) — no input injection, no synthetic
  // clicks, no Accessibility permission. BeeHive keeps running behind it; the
  // presenter switches back the normal way (Cmd-Tab, Dock, or clicking BeeHive).
  // Not used for entire-screen shares — there is no single window to activate,
  // and the existing full-screen behaviour is left untouched per spec.
  const controlWindowIdRef = useRef<number | null>(null)
  const canFocusSharedWindow = !isMobile && !!window.electronAPI?.activateSharedWindow && isSharing && !sharingEntireScreen && controlWindowIdRef.current != null

  const focusSharedWindow = useCallback(() => {
    if (!canFocusSharedWindow || controlWindowIdRef.current == null) return
    window.electronAPI?.activateSharedWindow?.(controlWindowIdRef.current)
  }, [canFocusSharedWindow])

  // Elapsed sharing time, for the persistent "You are sharing" indicator.
  const shareStartRef = useRef<number | null>(null)
  const [shareElapsedDisplay, setShareElapsedDisplay] = useState('0:00')
  useEffect(() => {
    if (!isSharing) { shareStartRef.current = null; return }
    shareStartRef.current = Date.now()
    setShareElapsedDisplay('0:00')
    const t = setInterval(() => {
      const sec = Math.floor((Date.now() - (shareStartRef.current ?? Date.now())) / 1000)
      const m = Math.floor(sec / 60), s = sec % 60
      setShareElapsedDisplay(`${m}:${String(s).padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(t)
  }, [isSharing])

  const [overlayMode, setOverlayMode] = useState<'visible' | 'minimized' | 'hidden'>('visible')
  const isPresenting = isSharing || hasRemoteScreenShare

  useEffect(() => {
    if (!isPresenting) setOverlayMode('visible')
  }, [isPresenting])

  const stopShare = useCallback(async () => {
    // Fire-and-forget — exits Keynote's/PowerPoint's slideshow if either is
    // running (no-ops otherwise); never awaited so AppleScript's round-trip
    // can't delay the UI's own stop-share flow.
    window.electronAPI?.stopPresentation?.()
    try { await localParticipant.setScreenShareEnabled(false) } catch {}
    secondaryStream?.getTracks().forEach(t => t.stop())
    localShareStream?.getTracks().forEach(t => t.stop())
    setSecondaryStream(null)
    setLocalShareStream(null)
    setIsSharing(false)
    setSharingEntireScreen(false)
    setShareLabel('')
    setActiveSlot('primary')
    controlWindowIdRef.current = null
  }, [localParticipant, secondaryStream, localShareStream])

  useEffect(() => { stopShareRef.current = stopShare }, [stopShare])

  const startShare = useCallback(async (forceHide = false) => {
    if (isAudience) { setDeviceErrorToast('You\'re in the audience — raise your hand and the host can give you the floor.'); return }
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
        // Biases the encoder toward sharpness/detail for static presentation
        // content — see shareDesktopSource's identical fix for the full
        // rationale; this is the web (non-Electron) capture path.
        if ('contentHint' in mediaTrack) mediaTrack.contentHint = 'detail'
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
  }, [clearBeforeShare, localParticipant, isAudience])

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

  // Hard kill-switch: on unmount (every way of leaving — Leave button,
  // alone-timer, remote disconnect, meeting ended), directly stop every
  // capture track this component could possibly hold: whatever's currently
  // on each LiveKit publication, plus the saved original camera track from
  // the background-effect pipeline. Plain MediaStreamTrack.stop() — terminal,
  // idempotent, and immune to SDK track-ownership semantics or async-cleanup
  // ordering (the background pipeline's replaceTrack restore is async, and on
  // Safari could lose the race against disconnect, leaving the camera LED on
  // in the lobby). Safe under StrictMode's synthetic first-mount cleanup:
  // at that point cam/mic are still off (no publications) and the ref is null.
  useEffect(() => () => {
    try {
      localParticipant.trackPublications.forEach((pub: any) => {
        try { pub.track?.mediaStreamTrack?.stop() } catch { /* already stopped */ }
      })
    } catch { /* ignore */ }
    try { bgOrigTrackRef.current?.stop() } catch { /* already stopped */ }
    bgOrigTrackRef.current = null
  }, [localParticipant])

  const leaveWithNotification = useCallback(async () => {
    // Explicit, direct camera/mic shutdown as the very first step — belt and
    // braces on top of the replaceTrack ownership fix above. That fix makes
    // LiveKit's own disconnect-time cleanup correctly stop the camera again;
    // this additionally guarantees it independent of any unmount/cleanup
    // ordering nuance, by calling the exact same official API the manual
    // camera-toggle button already uses successfully every time. Awaited
    // before anything else so the hardware is confirmed off before the rest
    // of the leave sequence (chat notice, DB updates, onLeave) even starts.
    try { await localParticipant.setCameraEnabled(false) } catch {}
    try { await localParticipant.setMicrophoneEnabled(false) } catch {}
    // Lower a raised hand on the way out — instant for everyone else via the
    // broadcast, rather than waiting on the (also-correct, but not
    // immediate) roster-diff cleanup below to notice the departure. That
    // cleanup remains the real backstop for every departure this can't
    // cover — crash, force-quit, lost network — this is just the fast path
    // for the ordinary "click Leave" case.
    if (myHandRaised) {
      try { handsChannelRef.current?.send({ type: 'broadcast', event: 'hand_lowered', payload: { identity: displayName } }) } catch {}
    }
    // Same fire-and-forget exit as stopShare — Leave should end a driven
    // presentation exactly like Stop Sharing does, not just disconnect BeeHive.
    window.electronAPI?.stopPresentation?.()
    try {
      await supabase.from('chat_messages').insert({ room_id: roomId, display_name: '__SYSTEM__', message: `__LEAVE__${displayName}` })
      await supabase.from('room_participants').update({ is_active: false }).eq('room_id', roomId).eq('display_name', displayName)
      const { count } = await supabase.from('room_participants').select('id', { count: 'exact', head: true }).eq('room_id', roomId).eq('is_active', true)
      if ((count ?? 0) === 0) {
        await supabase.from('rooms').update({ ended_at: new Date().toISOString(), is_active: false }).eq('id', roomId)
      }
    } catch { /* best-effort */ }
    onLeave()
  }, [roomId, displayName, onLeave, localParticipant, myHandRaised])

  // StrictMode mounts effects twice in dev, which double-inserted the
  // "joined" announcement — guard so one join announces exactly once.
  const joinAnnouncedRef = useRef<string | null>(null)
  // StrictMode's synthetic mount→cleanup→mount cycle (dev only) also made
  // this cleanup mark the participant inactive with nothing to ever flip it
  // back — "active" is only ever set once, server-side, at the moment of
  // joining, well before this component mounts. That's invisible for most
  // things (LiveKit's own connection is unaffected), but it silently broke
  // anything that reads this row's is_active/role afterward — notably the
  // waiting-room feature's host/co-host detection, which the row's is_active
  // being (wrongly) false made permanently invisible to its own creator.
  // Deferred via setTimeout(0): React's double-invoke happens synchronously
  // within the same effects flush, before any timer fires, so a genuine
  // remount (the StrictMode case) reaches the cancellation below first; a
  // real unmount (tab closed, navigated away) has no remount to cancel it,
  // so the deactivation still happens, just one tick later.
  const deactivateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const key = `${roomId}:${displayName}`
    if (joinAnnouncedRef.current !== key) {
      joinAnnouncedRef.current = key
      supabase.from('chat_messages').insert({ room_id: roomId, display_name: '__SYSTEM__', message: `__JOIN__${displayName}` }).then(() => {})
    }
    if (deactivateTimerRef.current) { clearTimeout(deactivateTimerRef.current); deactivateTimerRef.current = null }
    return () => {
      deactivateTimerRef.current = setTimeout(() => {
        supabase.from('room_participants').update({ is_active: false }).eq('room_id', roomId).eq('display_name', displayName).then(() => {})
      }, 0)
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

  // Uses liveKitParticipants (the live WebRTC room roster — the same source
  // the header's participant count and the floating dock already use), not
  // the Supabase `room_participants.is_active` flag. That flag is only ever
  // flipped by the LiveKit `participant_left` webhook (or an explicit leave),
  // both of which can lag or, on any webhook delivery hiccup, never fire at
  // all — leaving a stale row that never gets marked inactive. When that
  // drifts, this effect saw "alone" while the header/video grid correctly
  // showed multiple live participants, kicking everyone out of a meeting
  // that clearly wasn't empty. liveKitParticipants reflects who's actually
  // connected to the room right now — no possibility of staleness.
  useEffect(() => {
    const activeCount = liveKitParticipants.length
    if (activeCount <= 1) {
      if (aloneStartRef.current === null) aloneStartRef.current = Date.now()
    } else {
      aloneStartRef.current = null
      setAloneCountdown(null)
    }
  }, [liveKitParticipants])

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

  // Deliberately NOT a pre-flight gate. Two macOS facts make gating on
  // getMediaAccessStatus('screen') !== 'granted' self-defeating:
  //   1. The OS's own "BeeHive would like to record your screen" prompt only
  //      appears when the app actually ATTEMPTS a capture — a gate that
  //      refuses to attempt while not-yet-granted therefore guarantees the
  //      prompt can never appear, an unbreakable loop.
  //   2. For the 'screen' service specifically, macOS reports 'denied' even
  //      when the user has simply never been asked, so "not granted" cannot
  //      be read as "the user said no".
  // So: capture attempts always proceed (triggering the OS prompt when one
  // is owed), and this helper is called AFTER an attempt to warn — via
  // non-blocking toast, never alert(), which can wedge the renderer across
  // the focus loss/regain of a trip to System Settings — that macOS is
  // still withholding real pixels (attendees would see black frames).
  const notifyScreenPermissionProblem = useCallback(async () => {
    if (!window.electronAPI) return
    const status = await window.electronAPI.getScreenAccessStatus()
    if (status === 'granted') return
    if (window.electronAPI.openMediaPrivacySettings) {
      window.electronAPI.openMediaPrivacySettings('screen')
      setDeviceErrorToast('macOS is still blocking screen capture, so attendees may see a black screen. In the Settings pane that just opened, enable BeeHive under Screen & System Audio Recording, then quit (⌘Q) and reopen BeeHive.')
    } else {
      setDeviceErrorToast('macOS is still blocking screen capture — enable BeeHive in System Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen the app.')
    }
  }, [])

  const shareDesktopSource = useCallback(async (sourceId: string, isEntireScreen = false, windowTitle = '') => {
    setShowWindowPicker(false)
    // Electron's desktopCapturer id is "window:<CGWindowNumber>:0" for window
    // sources on macOS — an exact native window ID, not a guessable title match.
    const windowIdMatch = /^window:(\d+):/.exec(sourceId)
    controlWindowIdRef.current = windowIdMatch ? parseInt(windowIdMatch[1], 10) : null
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          // @ts-ignore — Electron-specific mandatory constraints
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280,
            // Previously capped at 1920x1080 — below the native/physical
            // resolution of most Retina MacBook displays (e.g. a 14" MBP
            // reports ~3024x1964), so any capture at or above 1080p was
            // being downscaled by getUserMedia itself before BeeHive ever
            // saw the frame — no CSS/object-fit change downstream can
            // recover detail that was already thrown away here. Raised to
            // a 4K ceiling; minWidth/minHeight are unchanged (still just a
            // floor, never forces upscaling of a genuinely small window).
            maxWidth: 3840,
            minHeight: 720,
            maxHeight: 2160,
          },
        },
      })
      const [rawTrack] = stream.getVideoTracks()
      if (!rawTrack) return

      // Biases the encoder toward sharpness/detail over motion smoothness —
      // correct for static presentation content (slides, text, diagrams).
      // Never set anywhere in this capture path before; left at the
      // browser's default, which is tuned for camera video, not screen
      // content. (LiveKit's own track processor can still force this back
      // to 'motion' under specific SVC/simulcast codec negotiations as its
      // own documented workaround — outside this app's control — but this
      // ensures BeeHive is never the one leaving it unset.)
      if ('contentHint' in rawTrack) rawTrack.contentHint = 'detail'

      const livekitTrack = new LocalVideoTrack(rawTrack, undefined, false)
      await localParticipant.publishTrack(livekitTrack, { source: Track.Source.ScreenShare })

      setLocalShareStream(stream)
      setShareLabel(windowTitle || rawTrack.label || 'Presentation')
      setIsSharing(true)
      setSharingEntireScreen(isEntireScreen)
      rawTrack.addEventListener('ended', () => stopShareRef.current?.())
      // Without Screen Recording permission, macOS doesn't make this capture
      // FAIL — it silently delivers black frames, so the success path is
      // exactly where the "attendees see nothing" case must be caught.
      await notifyScreenPermissionProblem()
    } catch {
      await notifyScreenPermissionProblem()
      setDeviceErrorToast(prev => prev ?? 'Could not capture screen — close and reopen the share menu to try again.')
    }
  }, [localParticipant, notifyScreenPermissionProblem])

  // Share the primary/entire screen:
  //   • Electron — resolves the primary display via display_id sort and captures
  //     it directly via the desktop capturer path (no OS picker shown).
  //   • Web — calls getDisplayMedia with displaySurface:'monitor' so the browser
  //     native picker opens with the full-screen option pre-selected, not tabs.
  const shareEntireScreen = useCallback(async () => {
    if (window.electronAPI) {
      // No permission pre-gate (see notifyScreenPermissionProblem) — this
      // getDesktopSources call is itself what makes macOS show its
      // Screen Recording prompt when the user has never been asked.
      const sources = await window.electronAPI.getDesktopSources({
        types: ['screen'],
        thumbnailSize: { width: 320, height: 180 },
      })
      if (sources.length === 0) { await notifyScreenPermissionProblem(); return }
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
        // See shareDesktopSource's identical fix for the full rationale.
        if ('contentHint' in rawTrack) rawTrack.contentHint = 'detail'
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
  }, [notifyScreenPermissionProblem, shareDesktopSource, clearBeforeShare, localParticipant])

  // Resolves a detected presentation-app WINDOW source to the SCREEN source
  // it currently sits on, matched via display_id (already forwarded by
  // electron/main.cjs's get-desktop-sources handler for both window and
  // screen entries). Root cause of "presentation mode doesn't scale/follow":
  // capturing the window by its chromeMediaSourceId stops following Keynote/
  // PowerPoint the instant they enter their own full-screen presentation
  // mode — macOS treats that as a new Space/window, so the window-handle
  // capture freezes on the pre-presentation editing view while the actual
  // full-screen slide plays on. Verified live (two-participant test):
  // display-matched screen capture correctly followed into full-screen;
  // window capture did not. Falls back to the window itself if no matching
  // screen source is found (a non-following share beats none at all) — the
  // window's own thumbnail/name still drive the confirmation preview either
  // way, only the actual capture target changes.
  const resolvePresentationCaptureSource = (
    match: { id: string; name: string; thumbnail: string; display_id?: string },
    allSources: { id: string; display_id?: string }[],
  ) => {
    const screenMatch = allSources.find(s => s.id.startsWith('screen:') && s.display_id === match.display_id)
    return {
      id: match.id,
      name: match.name,
      thumbnail: match.thumbnail,
      captureId: screenMatch?.id ?? match.id,
      isScreen: !!screenMatch,
    }
  }

  const sharePresentationWindow = useCallback(async () => {
    if (!window.electronAPI) return
    setDetectingWindow(true)
    try {
      const sources = await window.electronAPI.getDesktopSources({ thumbnailSize: { width: 640, height: 400 } })
      const keywords = ['keynote', 'powerpoint', 'impress', 'slides']
      const match = sources.find(src =>
        keywords.some(kw => src.name.toLowerCase().includes(kw))
      )
      if (match) {
        setPendingSource(resolvePresentationCaptureSource(match, sources))
      } else {
        setDesktopSources(sources)
        setShowWindowPicker(true)
      }
    } finally {
      setDetectingWindow(false)
    }
  }, [])

  const confirmAndShare = useCallback(async () => {
    if (!pendingSource) return
    window.electronAPI?.stopFloating()
    setPendingFile(null)
    setPresentStep('idle')
    const id = pendingSource.captureId ?? pendingSource.id
    const name = pendingSource.name
    const isScreen = pendingSource.isScreen ?? false
    setPendingSource(null)
    await shareDesktopSource(id, isScreen, name)
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
      setPendingSource(resolvePresentationCaptureSource(match, sources))
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

  // ============================================================
  // FLOATING CONTROL DOCK (desktop, window shares only)
  // ============================================================
  // Show the always-on-top Control Dock whenever the presenter is sharing a
  // specific window — that's when clicking the main-area preview backgrounds
  // BeeHive (see focusSharedWindow above), so the dock keeps the core meeting
  // controls reachable without switching back. Entire-screen shares don't need
  // this: there's no other-app foreground to lose BeeHive's controls behind.
  const showingDock = !isMobile && !!window.electronAPI?.showDock && isSharing && !sharingEntireScreen
  useEffect(() => {
    if (showingDock) window.electronAPI?.showDock?.()
    else window.electronAPI?.hideDock?.()
    // Leaving the meeting (Leave button, alone-timer, meeting ended) unmounts
    // this component in one step while isSharing is still true — the effect
    // body never re-runs with showingDock=false, so without this cleanup the
    // dock window stayed floating over the lobby with frozen timers.
    return () => { window.electronAPI?.hideDock?.() }
  }, [showingDock])

  // Currently-speaking participant (mirrors the logic SpeakingIndicator uses).
  const speakingName = liveKitParticipants.find(p => p.isSpeaking && p.audioLevel > 0.015)?.name || null

  // Connection quality — polled rather than relying on a specific hook
  // re-render trigger, so it stays accurate regardless of internal event timing.
  const [connectionQuality, setConnectionQuality] = useState<DockState['connectionQuality']>('unknown')
  useEffect(() => {
    if (!showingDock) return
    const tick = () => {
      const q = localParticipant.connectionQuality as string
      setConnectionQuality(q === 'excellent' ? 'excellent' : q === 'good' ? 'good' : q === 'poor' ? 'poor' : 'unknown')
    }
    tick()
    const t = setInterval(tick, 2000)
    return () => clearInterval(t)
  }, [showingDock, localParticipant])

  // Push consolidated state to the dock every second while it's visible —
  // simplest reliable approach given how many independent pieces of state feed it.
  useEffect(() => {
    if (!showingDock) return
    const push = () => {
      window.electronAPI?.pushDockState?.({
        micOn: localParticipant.isMicrophoneEnabled,
        camOn: localParticipant.isCameraEnabled,
        handRaised: myHandRaised,
        chatUnread: dmUnread.size,
        participantCount: activeCount,
        speakingName,
        connectionQuality,
        shareLabel: shareLabel || (sharingEntireScreen ? 'your entire screen' : 'a window'),
        shareElapsed: shareElapsedDisplay,
        meetingElapsed: elapsedDisplay,
        canControlSlides,
        raisedHandNames: raisedHands
          .filter(h => h.identity !== localParticipant.identity)
          .map(h => h.name.split(' ')[0]),
      })
    }
    push()
    const t = setInterval(push, 1000)
    return () => clearInterval(t)
  }, [showingDock, localParticipant, myHandRaised, dmUnread, activeCount, speakingName, connectionQuality, shareLabel, sharingEntireScreen, shareElapsedDisplay, elapsedDisplay, canControlSlides, raisedHands])

  // Actions dispatched from the dock — relayed here since only this renderer
  // holds the live LiveKit Room connection. Re-subscribes whenever any handler
  // changes (toggleRaiseHand isn't memoized) so the callback never closes over
  // stale state like an outdated myHandRaised.
  useEffect(() => {
    if (!window.electronAPI?.onDockAction) return
    return window.electronAPI.onDockAction((action) => {
      switch (action.type) {
        case 'toggle-mic': if (!isAudience) localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled); break
        case 'toggle-cam': if (!isAudience) localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled); break
        case 'toggle-hand': toggleRaiseHand(); break
        case 'stop-share': stopShare(); break
        case 'open-chat': setShowChat(true); break
        case 'open-participants': setShowParticipants(true); break
        case 'leave': leaveWithNotification(); break
      }
    })
  }, [localParticipant, toggleRaiseHand, stopShare, leaveWithNotification, setShowChat, setShowParticipants])

  return (
    <div
      // Self-view mirror state for every local camera <video> inside the room
      // (grid tile, dock, AutoCam) — see the bhv-self-view-mirror style block.
      // Default is mirrored, like looking in a mirror; Flip shows you as
      // others see you. Neither affects the published stream.
      data-bhv-mirror={bgFlip ? 'off' : 'on'}
      // Audience members: every mic / camera TrackToggle inside the room is
      // rendered inert — see the bhv-audience style block.
      data-bhv-audience={isAudience ? 'true' : 'false'}
      style={{ ...s.roomWrapper, opacity: roomHidden ? 0 : 1, transition: 'opacity 0.3s', pointerEvents: roomHidden ? 'none' : 'auto' }}
    >
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
            <span style={{ color: '#f5a623', fontWeight: 600 }}>{activeCount}</span>
            {!isSmallPhone && ` ${activeCount === 1 ? 'participant' : 'participants'}`}
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

      {/* Docked participants strip — always horizontal, always scrollable
          (never a grid), directly under the header. Opens only on an
          explicit click; see the auto-close effect above for when it
          closes itself. */}
      {showParticipants && participantsDocked && (
        <DockedParticipantsStrip
          onUndock={() => setParticipantsDocked(false)}
          onClose={() => { setShowParticipants(false); setParticipantsDocked(false) }}
          onDirectChat={name => { openDm(name); setShowChat(true) }}
          roomId={roomId}
          isHost={!!myHostSecret}
          hostSecret={myHostSecret}
          canModerate={canAdmit}
          actingDisplayName={displayName}
          onRequestUnmute={requestUnmute}
        />
      )}

      <div style={s.roomBody}>
        {/* Floating, detachable participants window — same always-horizontal,
            always-scrollable row as the docked strip above; drag the ⠿ title
            bar to reposition, drag toward the top to dock. */}
        {showParticipants && !participantsDocked && (
          <ParticipantsWindow
            onClose={() => setShowParticipants(false)}
            onDock={() => setParticipantsDocked(true)}
            onDirectChat={name => { openDm(name); setShowChat(true) }}
            roomId={roomId}
            isHost={!!myHostSecret}
            hostSecret={myHostSecret}
              canModerate={canAdmit}
            actingDisplayName={displayName}
            onRequestUnmute={requestUnmute}
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
            <div
              style={{ width: '100%', height: '100%', position: 'relative', background: '#060606', cursor: canFocusSharedWindow ? 'pointer' : undefined }}
              onClick={canFocusSharedWindow ? focusSharedWindow : undefined}
              title={canFocusSharedWindow ? `Click to switch to ${shareLabel || 'the shared window'}` : undefined}
            >
              {localShareStream && !sharingEntireScreen ? (
                <video
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  muted
                  playsInline
                  autoPlay
                  ref={el => { if (el && el.srcObject !== localShareStream) { el.srcObject = localShareStream; el.play().catch(() => {}) } }}
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

              {/* Persistent sharing indicator — "you are sharing" + what + elapsed
                  time + quick Stop. Always visible while sharing, unobtrusive. */}
              <div style={{ position: 'absolute', top: 14, left: 14, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', border: '1px solid #48bb78', borderRadius: 20, padding: '5px 8px 5px 12px' }} onClick={e => e.stopPropagation()}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#48bb78', animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
                <span style={{ color: '#48bb78', fontSize: 11, fontWeight: 600, fontFamily: "'Roboto', sans-serif", letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
                  You're sharing {sharingEntireScreen ? 'your entire screen' : shareLabel ? `“${shareLabel}”` : 'a window'}
                </span>
                <span style={{ color: '#48bb78', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif", opacity: 0.75, whiteSpace: 'nowrap' }}>{shareElapsedDisplay}</span>
                <button
                  onClick={stopShare}
                  title="Stop sharing"
                  style={{ background: 'rgba(197,48,48,0.18)', border: '1px solid rgba(229,115,115,0.5)', borderRadius: 12, color: '#e57373', fontSize: 10, fontWeight: 600, fontFamily: "'Roboto', sans-serif", padding: '3px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  Stop
                </button>
              </div>

              {/* Click-to-focus hint — window shares only; entire-screen is untouched. */}
              {canFocusSharedWindow && (
                <div style={{ position: 'absolute', bottom: 14, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(66,153,225,0.16)', backdropFilter: 'blur(6px)', border: '1px solid rgba(66,153,225,0.5)', borderRadius: 18, padding: '5px 12px', pointerEvents: 'none' }}>
                  <MousePointer2 size={12} color="#4299e1" />
                  <span style={{ color: '#9cc9f5', fontSize: 11, fontWeight: 300, fontFamily: "'Roboto', sans-serif" }}>Click to switch to this window</span>
                </div>
              )}
            </div>
          ) : (
            <GridLayout tracks={cameraTracks} style={{ height: '100%' }}>
              <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                <ParticipantTile />
                <CameraOffAvatarOverlay avatarUrlFor={avatarUrlFor} />
              </div>
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
              {/* Reopen the full-screen attendees/hands/reactions HUD once closed —
                  only needed in full-screen, where it's otherwise unreachable */}
              {isFullscreen && !showFullscreenHud && (
                <button
                  onClick={() => setShowFullscreenHud(true)}
                  title="Show attendees"
                  style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', border: '1px solid #333', borderRadius: 8, color: '#ccc', cursor: 'pointer' }}
                >
                  <Users size={17} />
                </button>
              )}
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

          {/* Meeting Prep Window — the checklist/agenda picked at scheduling time */}
          {showMeetingPrep && meetingPrep && overlayMode !== 'hidden' && (
            <MeetingPrepWindow
              roomId={roomId}
              prep={meetingPrep}
              onClose={() => setShowMeetingPrep(false)}
            />
          )}

          {/* Waiting-room admission requests — host/co-host only */}
          {showAdmissionRequests && canAdmit && overlayMode !== 'hidden' && (
            <AdmissionRequestsWindow
              roomId={roomId}
              pending={pendingAdmissions}
              hostSecret={myHostSecret}
              actingDisplayName={displayName}
              onClose={() => setShowAdmissionRequests(false)}
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
          <SpeakingIndicator overlayMode={isPresenting ? overlayMode : 'visible'} isPresenting={isPresenting} avatarUrlFor={avatarUrlFor} />

          <RoomAudioCoordination
            roomId={roomId}
            localParticipant={localParticipant}
            participants={liveKitParticipants}
            rawMicTrack={rawMicTrack}
          />

          {/* Right-edge button column: chat reopen chip, Personal Notes, Bot
              Assistant. Each child keeps its own absolute `bottom` (218 /
              154 / 90 from the video area's floor) — this wrapper just
              shifts the whole column up by however much the control bar
              has grown past its single-row height, so the column never
              lands on wrapped buttons at narrow widths. Zero offset on a
              normal desktop; the observer above supplies the number. */}
          {overlayMode !== 'hidden' && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 40, transform: `translateY(-${Math.max(0, controlsBarHeight - 68)}px)`, transition: 'transform 0.15s ease' }}>
              {/* pointer-events:none on the full-size wrapper so it never blocks
                  the video under it. pointer-events is inherited, so this inner
                  layer sets `auto` and — being display:contents — adds no box of
                  its own; the children hit-test normally against the wrapper. */}
              <div style={{ display: 'contents', pointerEvents: 'auto' }}>
                {!showChat && !isMobile && (
                  <button
                    style={s.chatReopenBtn}
                    className="bhv-btn"
                    onClick={() => setShowChat(true)}
                    title="Open chat"
                    aria-label="Open chat"
                  >
                    <MessageSquare size={18} />
                  </button>
                )}
                {/* BeeHive Bot Assistant — floating agenda helper, always available */}
                <BotAssistant roomId={roomId} displayName={displayName} canEdit={canAdmit} hostSecret={myHostSecret} />
                {/* Personal AI Note Taker — one per participant, fully isolated
                    from every other participant's session (see PersonalNotesToggle
                    / usePersonalNotes / 010_personal_meeting_notes.sql). */}
                <PersonalNotesToggle roomId={roomId} identity={localParticipant.identity || null} displayName={displayName} />
              </div>
            </div>
          )}

          {/* Full-screen HUD — floating attendees/hands/reactions/controls window,
              mounted inside the full-screen overlay so it's reachable in Full
              Presentation mode (see the isFullscreen comment above). */}
          {isFullscreen && showFullscreenHud && (
            <FullscreenHud
              attendees={liveKitParticipants.map(p => ({
                identity: p.identity,
                name: p.identity === localParticipant.identity ? 'You' : (p.name || p.identity),
                avatarUrl: avatarUrlFor(p.name || p.identity),
                isSpeaking: p.isSpeaking,
                isMicOn: p.isMicrophoneEnabled,
                isCamOn: p.isCameraEnabled,
              }))}
              raisedHands={raisedHands}
              onDismissHand={dismissHand}
              onLowerAllHands={lowerAllHands}
              myHandRaised={myHandRaised}
              onToggleHand={toggleRaiseHand}
              isMicOn={localParticipant.isMicrophoneEnabled}
              onToggleMic={() => { if (!isAudience) localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled) }}
              isCamOn={localParticipant.isCameraEnabled}
              onToggleCam={() => { if (!isAudience) localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled) }}
              onSendReaction={sendReaction}
              onLeave={leaveWithNotification}
              onClose={() => setShowFullscreenHud(false)}
            />
          )}

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
              {raisedHands.map(h => {
                // Attendees may only lower their own hand — the × is hidden
                // for everyone else's chip unless the viewer is host/co-host.
                // dismissHand() itself also guards this (defense in depth),
                // but the visible control shouldn't even suggest attendees
                // can act on hands that aren't theirs.
                const canDismissThis = h.identity === displayName || canAdmit
                return (
                  <div key={h.identity} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(12px)', border: '1px solid #444', borderRadius: 24, padding: '6px 10px 6px 12px', fontSize: 13, color: '#fff', fontFamily: "'Roboto', sans-serif", fontWeight: 300, whiteSpace: 'nowrap' as const }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>✋</span>
                    <span>{h.name}</span>
                    {canDismissThis && (
                      <button onClick={() => dismissHand(h.identity)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', display: 'flex', alignItems: 'center', padding: 0, marginLeft: 2 }} title="Lower hand">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                )
              })}
              {raisedHands.length > 1 && canAdmit && (
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
              // 44px floor: small phones previously dropped to 40px, under the
              // comfortable tap-target minimum. Icons inside stay 16px.
              const btnSize = isSmallPhone ? 44 : 46
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
                      onEffect={setBgEffect}
                      onPreset={setBgPresetId} onFlip={() => setBgFlip(v => !v)} onBlur={setBlurLevel}
                      onClose={() => setBgMenuOpen(false)}
                      backgrounds={bgLibrary.backgrounds} selectedBackgroundId={bgLibrary.selectedId}
                      backgroundsLoading={bgLibrary.loading} backgroundsError={bgLibrary.error}
                      onSelectBackground={handleSelectBackground} onAddBackground={handleAddBackground} onRemoveBackground={handleRemoveBackground}
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
                      <TrackToggle source={Track.Source.Microphone} style={mb} showIcon onDeviceError={handleMicDeviceError} />
                      {/* Speaker mute */}
                      <button
                        style={{ ...mb, ...(speakerMuted ? { background: '#4a1a1a', border: '1px solid #fc8181' } : {}) }}
                        onClick={toggleSpeaker}
                        title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
                      >
                        {speakerMuted ? <VolumeX size={isSmallPhone ? 16 : 18} /> : <Volume2 size={isSmallPhone ? 16 : 18} />}
                      </button>
                      {/* Camera */}
                      <TrackToggle source={Track.Source.Camera} style={mb} showIcon onDeviceError={handleCameraDeviceError} />
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
                      {/* Meeting Prep */}
                      {meetingPrep && (
                        <button
                          style={{ ...mb, ...(showMeetingPrep ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                          onClick={() => setShowMeetingPrep(v => !v)}
                          title="Meeting prep"
                        >
                          <ClipboardList size={isSmallPhone ? 16 : 18} />
                        </button>
                      )}
                      {/* Waiting Room — host/co-host only */}
                      {canAdmit && (
                        <button
                          style={{ ...mb, position: 'relative', ...(showAdmissionRequests ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                          onClick={() => setShowAdmissionRequests(v => !v)}
                          title="Waiting room"
                        >
                          <DoorOpen size={isSmallPhone ? 16 : 18} />
                          {pendingAdmissions.length > 0 && (
                            <span style={admissionBadgeStyle}>{pendingAdmissions.length}</span>
                          )}
                        </button>
                      )}
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
            <div style={s.controls}>
            <div style={{ ...s.controlsPill, gap: 8, padding: '8px 14px' }}>
              <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} showIcon onDeviceError={handleMicDeviceError} />
              <button
                style={{ ...s.controlBtn, ...(speakerMuted ? { background: '#4a1a1a', border: '1px solid #fc8181' } : {}) }}
                onClick={toggleSpeaker}
                title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
              >
                {speakerMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <TrackToggle source={Track.Source.Camera} style={s.controlBtn} showIcon onDeviceError={handleCameraDeviceError} />
              {isSharing && (
                <button style={{ ...s.controlBtn, background: '#276127', border: '1px solid #48bb78' }} onClick={stopShare} title="Stop sharing"><MonitorOff size={20} /></button>
              )}
              <div style={{ width: 1, height: 22, background: '#333' }} />
              <button onClick={() => setOverlayMode('visible')} style={{ ...s.controlBtn, fontSize: 16 }} title="Expand">⤢</button>
              <button onClick={() => setOverlayMode('hidden')} style={{ ...s.controlBtn }} title="Hide controls"><EyeOff size={18} /></button>
              <button style={{ ...s.controlBtn, background: '#c53030' }} onClick={leaveWithNotification} title="Leave"><PhoneOff size={20} /></button>
            </div>
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
            <div style={s.controls}>
            <div ref={controlsBarRef} style={{ ...s.controlsPill, overflow: 'visible' }} className="controls-bar">
              <TrackToggle source={Track.Source.Microphone} style={s.controlBtn} className="bhv-btn" showIcon onDeviceError={handleMicDeviceError} />
              <button className="bhv-btn"
                style={{ ...s.controlBtn, ...(speakerMuted ? { background: '#4a1a1a', border: '1px solid #fc8181' } : {}) }}
                onClick={toggleSpeaker}
                title={speakerMuted ? 'Unmute speaker' : 'Mute speaker'}
              >
                {speakerMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
              </button>
              <TrackToggle source={Track.Source.Camera} style={s.controlBtn} className="bhv-btn" showIcon onDeviceError={handleCameraDeviceError} />

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
                    onEffect={setBgEffect}
                    onPreset={setBgPresetId} onFlip={() => setBgFlip(v => !v)} onBlur={setBlurLevel}
                    onClose={() => setBgMenuOpen(false)}
                    backgrounds={bgLibrary.backgrounds} selectedBackgroundId={bgLibrary.selectedId}
                    backgroundsLoading={bgLibrary.loading} backgroundsError={bgLibrary.error}
                    onSelectBackground={handleSelectBackground} onAddBackground={handleAddBackground} onRemoveBackground={handleRemoveBackground}
                  />
                )}
              </div>

              {/* Meeting Prep — only shown when a prep template was picked at scheduling time */}
              {meetingPrep && (
                <button className="bhv-btn"
                  style={{ ...s.controlBtn, ...(showMeetingPrep ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                  onClick={() => setShowMeetingPrep(v => !v)}
                  title="Meeting prep"
                >
                  <ClipboardList size={20} />
                </button>
              )}

              {/* Waiting Room — host/co-host only, waiting-room-gated meetings only */}
              {canAdmit && (
                <button className="bhv-btn"
                  style={{ ...s.controlBtn, position: 'relative', ...(showAdmissionRequests ? { background: '#3a2a0a', border: '1px solid #f5a623' } : {}) }}
                  onClick={() => setShowAdmissionRequests(v => !v)}
                  title="Waiting room"
                >
                  <DoorOpen size={20} />
                  {pendingAdmissions.length > 0 && (
                    <span style={admissionBadgeStyle}>{pendingAdmissions.length}</span>
                  )}
                </button>
              )}

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
            </div>
            </>
          ) : null}
        </div>

        {/* Chat — floating panel over the video area (see s.sidebar). Closing
            it removes the panel entirely; the reopen chip lives in the
            right-edge button column inside the video area. One `showChat`
            state drives both, so there is never a duplicate panel or chip.
            bottom tracks the measured bar height so the panel clears a
            wrapped, two-row bar at narrow widths too. */}
        {showChat && (
          <div
            style={chatDocked ? s.sidebarDocked : { ...s.sidebar, bottom: controlsBarHeight + 32 }}
            role="complementary"
            aria-label="Chat"
          >
            <div style={s.sidebarTitle}>
              <span>Chat</span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {/* Dock ⇄ float. Same affordance as the participants strip's
                    ↙ Undock, kept as a plain icon button so both panels feel
                    like one system. */}
                <button
                  style={{ ...s.iconBtn, minWidth: 40, minHeight: 40 }}
                  onClick={toggleChatDocked}
                  title={chatDocked ? 'Float chat over the meeting' : 'Dock chat beside the meeting'}
                  aria-label={chatDocked ? 'Float chat' : 'Dock chat'}
                  aria-pressed={chatDocked}
                >
                  {chatDocked ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                </button>
                <button
                  style={{ ...s.iconBtn, minWidth: 40, minHeight: 40 }}
                  onClick={() => setShowChat(false)}
                  title="Close chat"
                  aria-label="Close chat"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

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
              {messages.map((m, i) => {
                if (m.message.startsWith('__DM__')) return null
                if (m.message.startsWith('__JOIN__') || m.message.startsWith('__LEAVE__')) {
                  // Collapse back-to-back duplicates (historic double-inserts
                  // from StrictMode remounts) into a single annotation line.
                  if (messages[i - 1]?.message === m.message) return null
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Avatar name={m.display_name} avatarUrl={avatarUrlFor(m.display_name)} size={18} />
                        <span style={s.msgName}>{m.display_name} shared a file</span>
                      </div>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Avatar name={m.display_name} avatarUrl={avatarUrlFor(m.display_name)} size={18} />
                      <span style={s.msgName}>{m.display_name}</span>
                    </div>
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
              <button style={{ ...s.sendBtn, background: accent }} onClick={handleSend}>↑</button>
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
                      {/* Live roster (LiveKit), not the old Supabase list — see myRole above. */}
                      {liveKitParticipants.filter(p => p.name !== displayName).map(p => {
                        const name = p.name ?? p.identity
                        const selected = (fileRecipients as string[]).includes(name)
                        return (
                          <label key={p.identity} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={selected}
                              style={{ accentColor: '#5b5ef4' }}
                              onChange={() => {
                                setFileRecipients(prev => {
                                  if (prev === 'all') return [name]
                                  return selected ? (prev as string[]).filter(n => n !== name) : [...(prev as string[]), name]
                                })
                              }}
                            />
                            <span style={{ color: '#ccc', fontSize: 13, fontFamily: "'Roboto', sans-serif" }}>{name}</span>
                          </label>
                        )
                      })}
                      {liveKitParticipants.filter(p => p.name !== displayName).length === 0 && (
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
          accent={accent}
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
          accent={accent}
        />
      )}

      {deviceErrorToast && (
        <Toast message={deviceErrorToast} onDone={() => setDeviceErrorToast(null)} durationMs={5000} />
      )}

      {admissionToast && (
        <Toast message={admissionToast} onDone={() => setAdmissionToast(null)} durationMs={5000} />
      )}

      {/* Audience member: a quiet, persistent explanation of why the mic and
          camera are inert, with the one action that leads somewhere. */}
      {isAudience && (
        <div style={{ position: 'fixed', left: '50%', bottom: 92, transform: 'translateX(-50%)', background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(12px)', border: '1px solid #333', borderRadius: 24, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 10, zIndex: 900, fontFamily: "'Roboto', sans-serif", fontSize: 12, color: '#ccc', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          <Users size={13} color="#f5a623" />
          <span>You're in the audience — <span style={{ color: '#f5a623' }}>raise your hand</span> to ask to speak</span>
        </div>
      )}
      {/* Promoted to speaker: the floor is theirs. Reuses the unmute prompt's
          exact shape so "Unmute" is one click away the moment rights arrive. */}
      {floorGranted && !isAudience && (
        <div
          role="alertdialog"
          aria-label="The host has given you the floor"
          style={{
            position: 'fixed', left: '50%', top: 72, transform: 'translateX(-50%)',
            background: '#1a1a1a', border: '1px solid #f5a623', borderRadius: 10,
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 1000, fontFamily: "'Roboto', sans-serif", maxWidth: 440,
          }}
        >
          <Mic size={16} color="#f5a623" />
          <span style={{ color: '#eee', fontSize: 13, fontWeight: 300, flex: 1 }}>The host has given you the floor — you can speak now</span>
          <button
            onClick={async () => {
              setFloorGranted(false)
              try { await localParticipant.setMicrophoneEnabled(true) } catch (e) { handleMicDeviceError(e as Error) }
            }}
            style={{ background: '#f5a623', color: '#111', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
          >
            Unmute
          </button>
          <button
            onClick={() => setFloorGranted(false)}
            style={{ background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
          >
            Later
          </button>
        </div>
      )}

      {/* Host asked this participant to unmute. Rendered as an actionable
          prompt, not a passive notice: LiveKit refuses a remote unmute
          (LiveKit Cloud has no enable_remote_unmute) and browsers won't
          open a mic without the user's own gesture, so the ONE thing that
          can turn this mic on is the attendee clicking here. That single
          click is what gives the host's request its teeth. Stays until
          answered — a 5 s toast was easy to miss mid-meeting. */}
      {unmuteRequested && (
        <div
          role="alertdialog"
          aria-label="The host is asking you to unmute"
          style={{
            position: 'fixed', left: '50%', top: 72, transform: 'translateX(-50%)',
            background: '#1a1a1a', border: '1px solid #f5a623', borderRadius: 10,
            padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.5)', zIndex: 1000, fontFamily: "'Roboto', sans-serif", maxWidth: 420,
            animation: 'bhv-toast-in 0.25s cubic-bezier(0.4,0,0.2,1)',
          }}
        >
          <style>{`@keyframes bhv-toast-in { from { opacity: 0; transform: translate(-50%, -8px) } to { opacity: 1; transform: translate(-50%, 0) } }`}</style>
          <Mic size={16} color="#f5a623" />
          <span style={{ color: '#eee', fontSize: 13, fontWeight: 300, flex: 1 }}>The host is asking you to unmute</span>
          <button
            onClick={async () => {
              setUnmuteRequested(false)
              try { await localParticipant.setMicrophoneEnabled(true) } catch (e) { handleMicDeviceError(e as Error) }
            }}
            style={{ background: '#f5a623', color: '#111', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
          >
            Unmute
          </button>
          <button
            onClick={() => setUnmuteRequested(false)}
            title="Stay muted"
            style={{ background: 'none', color: '#888', border: '1px solid #333', borderRadius: 6, padding: '6px 10px', fontSize: 12, cursor: 'pointer', fontFamily: "'Roboto', sans-serif" }}
          >
            Not now
          </button>
        </div>
      )}
    </div>
  )
}
