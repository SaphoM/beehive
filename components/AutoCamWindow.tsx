import { useState, useEffect, useRef } from 'react'
import { X, Crosshair, Users, VideoOff } from 'lucide-react'
import { ParticipantTile, useTracks, useLocalParticipant, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'

export function AutoCamWindow({ mode, onModeChange, onClose }: {
  mode: 'center' | 'split'
  onModeChange: (m: 'center' | 'split') => void
  onClose: () => void
}) {
  const participants = useLiveKitParticipants()
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false })
  const { localParticipant } = useLocalParticipant()

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
        }, 1500)
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

      {mode === 'split' && (
        <div style={s.autoCamSplitRow}>
          <div style={s.autoCamHalf}>
            {localTrack ? (
              <ParticipantTile trackRef={localTrack} style={{ width: '100%', height: '100%' }} />
            ) : (
              <div style={s.autoCamNoVideo}><VideoOff size={16} color="#444" /></div>
            )}
            <div style={s.autoCamSplitLabel}>You</div>
          </div>
          <div style={s.autoCamDivider} />
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
