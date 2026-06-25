import { useState, useEffect, useRef } from 'react'
import { X, Video, VideoOff } from 'lucide-react'
import { ParticipantTile, useTracks, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'

const BAR_SHAPE = [0.35, 0.65, 1.0, 0.65, 0.35]

interface Speaker { identity: string; name: string; level: number }

function SpeakerWindow({
  speaker,
  camTrack,
  minimized,
  dismissed,
  onToggleMinimize,
  onDismiss,
  anchor,
  overlayMode,
  className,
}: {
  speaker: Speaker
  camTrack: ReturnType<typeof useTracks>[number] | undefined
  minimized: boolean
  dismissed: boolean
  onToggleMinimize: () => void
  onDismiss: () => void
  anchor: 'left' | 'right'
  overlayMode: 'visible' | 'minimized' | 'hidden'
  className?: string
}) {
  const showWindow = !minimized && !dismissed && overlayMode !== 'minimized'

  const wrapStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: 20,
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
              <button style={s.speakerWindowBtn} title="Minimise" onClick={onToggleMinimize}>—</button>
              <button style={s.speakerWindowBtn} title="Close" onClick={onDismiss}>
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

      <div style={s.speakingChip}>
        {minimized && !dismissed && (
          <button style={s.speakerRestoreBtn} title="Show video" onClick={onToggleMinimize}>
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
}: {
  overlayMode?: 'visible' | 'minimized' | 'hidden'
  isPresenting?: boolean
}) {
  const participants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const [speakers, setSpeakers] = useState<Speaker[]>([])

  // Primary speaker (always shown)
  const [minimized1, setMinimized1] = useState(false)
  const [dismissed1, setDismissed1] = useState<string | null>(null)

  // Second speaker (presentation mode only)
  const [minimized2, setMinimized2] = useState(false)
  const [dismissed2, setDismissed2] = useState<string | null>(null)

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

  // Auto-clear dismissals when a new person becomes the primary/secondary speaker
  useEffect(() => {
    if (speakers.length > 0 && dismissed1 && speakers[0].identity !== dismissed1) setDismissed1(null)
    if (speakers.length > 1 && dismissed2 && speakers[1].identity !== dismissed2) setDismissed2(null)
  }, [speakers, dismissed1, dismissed2])

  if (speakers.length === 0 || overlayMode === 'hidden') return null

  const s1 = speakers[0]
  const s2 = isPresenting && speakers.length >= 2 ? speakers[1] : null

  const cam1 = cameraTracks.find(t => t.participant.identity === s1.identity)
  const cam2 = s2 ? cameraTracks.find(t => t.participant.identity === s2.identity) : undefined

  return (
    <>
      {/* Primary speaker — always bottom-left */}
      <SpeakerWindow
        speaker={s1}
        camTrack={cam1}
        minimized={minimized1}
        dismissed={dismissed1 === s1.identity}
        onToggleMinimize={() => setMinimized1(v => !v)}
        onDismiss={() => setDismissed1(s1.identity)}
        anchor="left"
        overlayMode={overlayMode}
        className="speaking-wrap"
      />

      {/* Second speaker — presentation mode only, bottom-right */}
      {s2 && dismissed2 !== s2.identity && (
        <SpeakerWindow
          speaker={s2}
          camTrack={cam2}
          minimized={minimized2}
          dismissed={dismissed2 === s2.identity}
          onToggleMinimize={() => setMinimized2(v => !v)}
          onDismiss={() => setDismissed2(s2.identity)}
          anchor="right"
          overlayMode={overlayMode}
        />
      )}
    </>
  )
}
