import { useState, FormEvent } from 'react'
import { X, Copy, Check } from 'lucide-react'
import { useAuth } from '../livekit_react_hooks'

const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001' : ''

interface Props {
  roomId: string | null
  onClose: () => void
}

export function InviteModal({ roomId, onClose }: Props) {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleSend(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !session) return
    setErr(null); setBusy(true)

    const res = await fetch(`${API_BASE}/api/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ invited_email: email, room_id: roomId }),
    })
    const data = await res.json()
    setBusy(false)

    if (data.error) { setErr(data.error); return }

    // Build join link: include room_id + invite token
    const base = window.location.origin || 'https://beehive.xspark.co.za'
    const link = roomId
      ? `${base}/?room=${roomId}&invite=${data.token}`
      : `${base}/?invite=${data.token}`
    setInviteLink(link)
  }

  async function copyLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }
  const modal: React.CSSProperties = {
    background: '#111', border: '1px solid #222', borderRadius: 14,
    padding: '28px 28px 24px', width: 340, display: 'flex', flexDirection: 'column', gap: 16,
    boxShadow: '0 8px 40px rgba(0,0,0,0.7)',
  }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
  const inp: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 14, padding: '10px 12px', width: '100%', outline: 'none', boxSizing: 'border-box' }
  const primaryBtn: React.CSSProperties = { background: '#f5c518', color: '#000', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, padding: '11px 0', cursor: 'pointer', width: '100%' }
  const ghostBtn: React.CSSProperties = { background: 'transparent', color: '#888', border: '1px solid #333', borderRadius: 8, fontSize: 13, padding: '9px 0', cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }
  const errStyle: React.CSSProperties = { color: '#f55', fontSize: 12, background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.2)', borderRadius: 6, padding: '8px 10px' }
  const linkBox: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#aaa', wordBreak: 'break-all', lineHeight: 1.5 }

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={row}>
          <h2 style={{ color: '#fff', fontSize: 15, fontWeight: 500 }}>Invite to meeting</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#555' }}>
            <X size={16} />
          </button>
        </div>

        {!inviteLink ? (
          <form onSubmit={handleSend} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              style={inp}
              type="email"
              placeholder="colleague@company.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoFocus
              autoComplete="off"
            />
            {err && <p style={errStyle}>{err}</p>}
            <button style={primaryBtn} type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send invitation'}
            </button>
          </form>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ color: '#5f5', fontSize: 12 }}>Invitation created for <strong>{email}</strong></p>
            <p style={linkBox}>{inviteLink}</p>
            <button style={ghostBtn} type="button" onClick={copyLink}>
              {copied ? <Check size={13} color="#5f5" /> : <Copy size={13} />}
              {copied ? 'Copied!' : 'Copy invite link'}
            </button>
            <button style={{ ...ghostBtn, marginTop: 4 }} type="button" onClick={() => { setEmail(''); setInviteLink(null); setErr(null) }}>
              Invite another person
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
