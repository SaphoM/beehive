import { useState, useEffect, useRef } from 'react'
import { X, Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { ParticipantTile, useTracks, useParticipants as useLiveKitParticipants } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { s } from './roomStyles'

export function ParticipantsWindow({ onClose, onDock }: { onClose: () => void; onDock: () => void }) {
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

export function DockedParticipantsStrip({ onUndock, onClose }: { onUndock: () => void; onClose: () => void }) {
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
