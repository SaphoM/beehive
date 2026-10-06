import { useState } from 'react'
import { X, Minus, Mic, MicOff, Video, VideoOff, Hand, PhoneOff, Users } from 'lucide-react'
import { REACTIONS } from './roomUtils'
import { Avatar } from './Avatar'

// Full-screen presentation mode (`isFullscreen` in RoomPage.tsx) renders the
// video/screen-share area as a fixed, full-viewport overlay above everything
// else — which also visually buries the normal floating Participants window
// (it lives outside that fixed container). This HUD is a self-contained
// floating window mounted *inside* the fullscreen container instead, so
// attendees, raised hands, quick reactions, and the core call controls stay
// reachable without leaving full-screen. Purely additive: it doesn't touch
// how the regular (non-fullscreen) Participants window, hands, or reactions
// already work.
export function FullscreenHud({
  attendees,
  raisedHands,
  onDismissHand,
  onLowerAllHands,
  myHandRaised,
  onToggleHand,
  isMicOn,
  onToggleMic,
  isCamOn,
  onToggleCam,
  onSendReaction,
  onLeave,
  onClose,
}: {
  attendees: { identity: string; name: string; avatarUrl?: string | null; isSpeaking: boolean; isMicOn: boolean; isCamOn: boolean }[]
  raisedHands: { identity: string; name: string }[]
  onDismissHand: (identity: string) => void
  onLowerAllHands: () => void
  myHandRaised: boolean
  onToggleHand: () => void
  isMicOn: boolean
  onToggleMic: () => void
  isCamOn: boolean
  onToggleCam: () => void
  onSendReaction: (emoji: string) => void
  onLeave: () => void
  onClose: () => void
}) {
  const [minimized, setMinimized] = useState(false)

  const font = "'Roboto', sans-serif"
  const iconBtn: React.CSSProperties = {
    width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'none', border: 'none', color: '#999', cursor: 'pointer', borderRadius: 6,
  }

  if (minimized) {
    return (
      <div
        style={{
          position: 'absolute', top: 60, right: 14, zIndex: 9200,
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(10,10,10,0.88)', backdropFilter: 'blur(12px)',
          border: '1px solid #333', borderRadius: 24, padding: '6px 8px 6px 14px',
          cursor: 'pointer',
        }}
        onClick={() => setMinimized(false)}
        title="Expand attendees panel"
      >
        <Users size={14} color="#f5a623" />
        <span style={{ color: '#f5a623', fontSize: 12, fontWeight: 600, fontFamily: font }}>{attendees.length}</span>
        {raisedHands.length > 0 && <span style={{ fontSize: 13 }}>✋ {raisedHands.length}</span>}
        <button
          style={{ ...iconBtn, width: 22, height: 22, color: '#666' }}
          onClick={e => { e.stopPropagation(); onClose() }}
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'absolute', top: 60, right: 14, zIndex: 9200, width: 260,
        maxHeight: 'calc(100% - 100px)', display: 'flex', flexDirection: 'column',
        background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(16px)',
        border: '1px solid #333', borderRadius: 14, overflow: 'hidden',
        boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 8px 10px 14px', borderBottom: '1px solid #262626' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#eee', fontSize: 12, fontWeight: 600, fontFamily: font }}>
          <Users size={14} color="#f5a623" /> Attendees ({attendees.length})
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={iconBtn} onClick={() => setMinimized(true)} title="Minimise"><Minus size={14} /></button>
          <button style={iconBtn} onClick={onClose} title="Close"><X size={14} /></button>
        </div>
      </div>

      {raisedHands.length > 0 && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #262626', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#888', fontSize: 10, fontFamily: font, letterSpacing: 0.5, textTransform: 'uppercase' as const }}>Raised hands</span>
            {raisedHands.length > 1 && (
              <button onClick={onLowerAllHands} style={{ background: 'none', border: 'none', color: '#666', fontSize: 10, fontFamily: font, cursor: 'pointer' }}>Lower all</button>
            )}
          </div>
          {raisedHands.map(h => (
            <div key={h.identity} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span style={{ color: '#ddd', fontSize: 12, fontFamily: font, display: 'flex', alignItems: 'center', gap: 6 }}>✋ {h.name}</span>
              <button onClick={() => onDismissHand(h.identity)} style={{ ...iconBtn, width: 20, height: 20 }} title="Lower hand"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
        {attendees.map(a => (
          <div key={a.identity} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <Avatar name={a.name} avatarUrl={a.avatarUrl} size={18} />
              <span style={{
                color: a.isSpeaking ? '#f5a623' : '#ddd', fontSize: 12.5, fontFamily: font, fontWeight: a.isSpeaking ? 600 : 300,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
              }}>
                {a.name}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
              {a.isMicOn ? <Mic size={12} color="#666" /> : <MicOff size={12} color="#c53030" />}
              {a.isCamOn ? <Video size={12} color="#666" /> : <VideoOff size={12} color="#c53030" />}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '8px 10px', borderTop: '1px solid #262626', justifyContent: 'center' }}>
        {REACTIONS.map(e => (
          <button
            key={e}
            onClick={() => onSendReaction(e)}
            style={{ background: 'none', border: 'none', fontSize: 17, cursor: 'pointer', padding: '2px 3px' }}
          >
            {e}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '8px 10px 12px', justifyContent: 'center' }}>
        <button
          onClick={onToggleMic}
          title={isMicOn ? 'Mute' : 'Unmute'}
          style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: isMicOn ? '#2a2a2a' : '#c53030', border: 'none', color: '#fff' }}
        >
          {isMicOn ? <Mic size={14} /> : <MicOff size={14} />}
        </button>
        <button
          onClick={onToggleCam}
          title={isCamOn ? 'Stop video' : 'Start video'}
          style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: isCamOn ? '#2a2a2a' : '#c53030', border: 'none', color: '#fff' }}
        >
          {isCamOn ? <Video size={14} /> : <VideoOff size={14} />}
        </button>
        <button
          onClick={onToggleHand}
          title={myHandRaised ? 'Lower hand' : 'Raise hand'}
          style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: myHandRaised ? '#2a3a1a' : '#2a2a2a', border: myHandRaised ? '1px solid #68d391' : 'none', color: myHandRaised ? '#68d391' : '#fff' }}
        >
          <Hand size={14} />
        </button>
        <button
          onClick={onLeave}
          title="Leave call"
          style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: '#c53030', border: 'none', color: '#fff' }}
        >
          <PhoneOff size={14} />
        </button>
      </div>
    </div>
  )
}
