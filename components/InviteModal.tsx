import { useState } from 'react'
import { X, Copy, Check, Link } from 'lucide-react'
import { WEB_BASE } from './roomUtils'

interface Props {
  roomId: string | null
  onClose: () => void
  // Signature gold, or STING_RED when the meeting is in Sting mode — passed
  // down from RoomPage's `accent` so this button matches the rest of the room.
  accent?: string
}

export function InviteModal({ roomId, onClose, accent = '#f5a623' }: Props) {
  const [copied, setCopied] = useState(false)

  // WEB_BASE is the deployed web URL (VITE_WEB_BASE_URL), with a same-origin fallback
  // for the web. It intentionally resolves to '' under Electron's file:// origin so we
  // never generate an un-shareable file:// invite link.
  const link = roomId ? `${WEB_BASE}/?room=${roomId}` : WEB_BASE

  async function copyLink() {
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modal: React.CSSProperties = {
    background: '#111', border: '1px solid #222', borderRadius: 14,
    padding: '26px 26px 22px', width: 360, display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
  }
  const linkBox: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8,
    padding: '10px 12px', fontSize: 12, color: '#aaa',
    wordBreak: 'break-all', lineHeight: 1.6, userSelect: 'all',
    cursor: 'text',
  }
  const copyBtn: React.CSSProperties = {
    background: copied ? '#1a3a1a' : accent,
    color: copied ? '#48bb78' : '#000',
    border: copied ? '1px solid #48bb78' : 'none',
    borderRadius: 8, fontWeight: 600, fontSize: 14,
    padding: '11px 0', cursor: 'pointer', width: '100%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    transition: 'background 0.2s, color 0.2s',
  }

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link size={15} color={accent} />
            <h2 style={{ color: '#fff', fontSize: 15, fontWeight: 500, margin: 0 }}>Invite to meeting</h2>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555', display: 'flex', alignItems: 'center' }}>
            <X size={16} />
          </button>
        </div>

        {/* Link */}
        <div>
          <p style={{ color: '#555', fontSize: 11, fontWeight: 300, letterSpacing: 0.5, margin: '0 0 8px', textTransform: 'uppercase' }}>
            Meeting link
          </p>
          <div style={linkBox} onClick={copyLink} title="Click to copy">
            {link}
          </div>
        </div>

        {/* Copy button */}
        <button style={copyBtn} onClick={copyLink}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied!' : 'Copy link'}
        </button>

        {/* Footer note */}
        <p style={{ color: '#444', fontSize: 11, fontWeight: 300, margin: 0, lineHeight: 1.6, textAlign: 'center' }}>
          Anyone with this link can join — no account required.
        </p>
      </div>
    </div>
  )
}
