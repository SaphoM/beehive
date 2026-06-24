import { useState, useEffect, useRef } from 'react'
import { X, Video, VideoOff } from 'lucide-react'
import { ParticipantTile, useTracks, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'

export function SpeakingIndicator({ overlayMode = 'visible' }: { overlayMode?: 'visible' | 'minimized' | 'hidden' }) {
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
