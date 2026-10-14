import { useState, useEffect, useRef } from 'react'
import { X, Video, Mic } from 'lucide-react'
import { ParticipantTile, useTracks, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'
import { Avatar } from './Avatar'

const BAR_SHAPE = [0.35, 0.65, 1.0, 0.65, 0.35]

// `name` is truncated to the first word for the compact chip/header display
// (unchanged) — `fullName` is kept alongside it since avatar lookup needs
// the real display_name, not just "Sapho" out of "Sapho Maqhwazima".
interface Speaker { identity: string; name: string; fullName: string; level: number }

function SpeakerWindow({
  speaker,
  camTrack,
  avatarUrl,
  videoOpen,
  onOpenVideo,
  onCloseVideo,
  onCloseMonitor,
  anchor,
  overlayMode,
  className,
}: {
  speaker: Speaker
  camTrack: ReturnType<typeof useTracks>[number] | undefined
  avatarUrl?: string | null
  videoOpen: boolean
  onOpenVideo: () => void
  onCloseVideo: () => void
  onCloseMonitor: () => void
  anchor: 'left' | 'right'
  overlayMode: 'visible' | 'minimized' | 'hidden'
  className?: string
}) {
  const showWindow = videoOpen && overlayMode !== 'minimized'

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    // The desktop control dock (s.controls in roomStyles.ts) sits at
    // bottom:20 and is 68px tall (48px buttons + 20px vertical padding), so
    // its top edge is at 88px from the bottom of this same positioning
    // context. 100px clears it with a small gap — without this, the speaker
    // window's bottom edge sat right on top of the dock buttons.
    bottom: 100,
    ...(anchor === 'left' ? { left: 20 } : { right: 20 }),
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    zIndex: 15,
  }

  return (
    <div style={wrapStyle} className={className}>
      {showWindow && (
        <div style={s.speakerWindow}>
          <div style={s.speakerWindowHeader}>
            <span style={s.speakerWindowName}>{speaker.name}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={s.speakerWindowBtn} title="Minimise video" onClick={onCloseVideo}>—</button>
              <button style={s.speakerWindowBtn} title="Close monitor" onClick={onCloseMonitor}>
                <X size={11} />
              </button>
            </div>
          </div>
          <div style={s.speakerVideoArea}>
            {camTrack ? (
              <ParticipantTile trackRef={camTrack} style={{ width: '100%', height: '100%', borderRadius: '0 0 10px 10px' }} />
            ) : (
              <div style={s.speakerNoVideo}><Avatar name={speaker.fullName} avatarUrl={avatarUrl} size={44} /></div>
            )}
          </div>
        </div>
      )}

      {/* The chip is the persistent audio monitor — it is what's always
          running while the monitor isn't fully closed. Clicking it opens the
          video preview; it never opens video on its own (e.g. just because
          someone started speaking). The window header's — only collapses the
          video and leaves this chip (and speaker detection) untouched; its ×
          is the only thing that closes the whole monitor. */}
      <div
        style={{ ...s.speakingChip, cursor: videoOpen ? 'default' : 'pointer' }}
        onClick={videoOpen ? undefined : onOpenVideo}
        role={videoOpen ? undefined : 'button'}
        title={videoOpen ? undefined : 'Show video'}
      >
        {!videoOpen && (
          <button style={s.speakerRestoreBtn} title="Show video" onClick={(e) => { e.stopPropagation(); onOpenVideo() }}>
            <Video size={11} />
          </button>
        )}
        <div style={s.soundBars}>
          {BAR_SHAPE.map((mult, j) => (
            <div key={j} style={{ ...s.soundBar, transform: `scaleY(${Math.max(0.15, speaker.level * mult)})` }} />
          ))}
        </div>
        <span style={s.speakingName}>{speaker.name}</span>
      </div>
    </div>
  )
}

export function SpeakingIndicator({
  overlayMode = 'visible',
  isPresenting = false,
  avatarUrlFor,
}: {
  overlayMode?: 'visible' | 'minimized' | 'hidden'
  isPresenting?: boolean
  avatarUrlFor?: (name: string) => string | null
}) {
  const participants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const [speakers, setSpeakers] = useState<Speaker[]>([])

  // Primary monitor (always active for the meeting unless explicitly closed).
  // videoOpen1 starts false: joining a meeting activates audio monitoring
  // only — video only opens when the user clicks the chip. monitorClosed1
  // is a persistent local choice (× button), independent of who's currently
  // speaking, so it does NOT auto-clear when a different person starts
  // talking (unlike the old per-identity "dismissed" behaviour it replaces).
  const [videoOpen1, setVideoOpen1] = useState(false)
  const [monitorClosed1, setMonitorClosed1] = useState(false)

  // Second monitor (presentation mode only) — same open/closed model,
  // scoped to its own state since it's an independent window.
  const [videoOpen2, setVideoOpen2] = useState(false)
  const [monitorClosed2, setMonitorClosed2] = useState(false)

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const tick = setInterval(() => {
      const active = participants
        .filter(p => p.isSpeaking && p.audioLevel > 0.015)
        .map(p => {
          const fullName = p.name || p.identity
          return { identity: p.identity, name: fullName.split(' ')[0], fullName, level: Math.min(p.audioLevel * 2.5, 1) }
        })

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

  if (overlayMode === 'hidden') return null

  const s1 = speakers[0]
  const s2 = isPresenting && speakers.length >= 2 ? speakers[1] : null

  const cam1 = s1 ? cameraTracks.find(t => t.participant.identity === s1.identity) : undefined
  const cam2 = s2 ? cameraTracks.find(t => t.participant.identity === s2.identity) : undefined

  // Nothing to show at all: monitor not closed, but no one is speaking —
  // the audio monitor has no data to display, same as before this fix.
  if (!monitorClosed1 && !s1) return null

  return (
    <>
      {/* Primary monitor — always bottom-left. The restore control is
          independent of active-speaker detection: it must stay visible
          while monitorClosed1 is true even if no one is currently
          speaking, so a × close can always be undone. */}
      {monitorClosed1 ? (
        <button
          style={{ ...s.speakerMonitorRestore, left: 20 }}
          title="Show speaking monitor"
          aria-label="Show speaking monitor"
          onClick={() => setMonitorClosed1(false)}
        >
          <Mic size={15} />
        </button>
      ) : s1 && (
        <SpeakerWindow
          speaker={s1}
          camTrack={cam1}
          avatarUrl={avatarUrlFor?.(s1.fullName)}
          videoOpen={videoOpen1}
          onOpenVideo={() => setVideoOpen1(true)}
          onCloseVideo={() => setVideoOpen1(false)}
          onCloseMonitor={() => { setVideoOpen1(false); setMonitorClosed1(true) }}
          anchor="left"
          overlayMode={overlayMode}
          className="speaking-wrap"
        />
      )}

      {/* Second speaker — presentation mode only, bottom-right */}
      {s2 && !monitorClosed2 && (
        <SpeakerWindow
          speaker={s2}
          camTrack={cam2}
          avatarUrl={avatarUrlFor?.(s2.fullName)}
          videoOpen={videoOpen2}
          onOpenVideo={() => setVideoOpen2(true)}
          onCloseVideo={() => setVideoOpen2(false)}
          onCloseMonitor={() => { setVideoOpen2(false); setMonitorClosed2(true) }}
          anchor="right"
          overlayMode={overlayMode}
        />
      )}
    </>
  )
}
