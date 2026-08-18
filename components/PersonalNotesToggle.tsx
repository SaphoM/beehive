// ============================================================
// PERSONAL AI NOTE TAKER — floating toggle + panel
// ============================================================
// Self-contained, mirroring BotAssistant.tsx's floating-button pattern so
// this doesn't need to be threaded into any of the meeting's several
// responsive control-bar variants. All isolation logic (start/stop/secret/
// polling) lives in usePersonalNotes (livekit_react_hooks.tsx) — this
// component is presentation only.
import { useState } from 'react'
import { NotebookPen, X } from 'lucide-react'
import { usePersonalNotes } from '../livekit_react_hooks'
import { LiteMarkdown } from './liteMarkdown'

export function PersonalNotesToggle({
  roomId,
  identity,
  displayName,
}: {
  roomId: string
  identity: string | null
  displayName: string
}) {
  const [open, setOpen] = useState(false)
  const { enabled, pending, error, note, start, stop } = usePersonalNotes(roomId, identity, displayName)

  return (
    <>
      {/* Stacked directly above BotAssistant's own fab (bottom:90, right:24,
          zIndex:40, 52px tall — see BotAssistant.tsx's `st.fab`), not on top
          of it: same right-edge alignment, positioned clear of its full
          height plus a gap so the two floating buttons never overlap. */}
      <button
        onClick={() => setOpen(v => !v)}
        title="Your personal AI Note Taker"
        style={{
          position: 'absolute', bottom: 154, right: 24, zIndex: 40,
          width: 44, height: 44, borderRadius: '50%',
          background: enabled ? '#f5a623' : 'rgba(10,10,10,0.85)',
          border: enabled ? 'none' : '1px solid #333',
          color: enabled ? '#000' : '#ccc',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.4)',
        }}
      >
        <NotebookPen size={19} />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', bottom: 206, right: 24, zIndex: 41,
            width: 300, maxHeight: 420, overflowY: 'auto',
            background: 'rgba(12,12,12,0.97)', backdropFilter: 'blur(12px)',
            border: '1px solid #333', borderRadius: 12, padding: 14,
            fontFamily: "'Roboto', sans-serif", boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>My AI Note Taker</span>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex' }}>
              <X size={15} />
            </button>
          </div>

          <p style={{ color: '#999', fontSize: 11.5, lineHeight: 1.5, margin: '0 0 12px' }}>
            Your own notes, private to you — starting, stopping, or restarting this never
            affects any other participant's AI Note Taker.
          </p>

          {error && (
            <div style={{ color: '#ef4444', fontSize: 11.5, marginBottom: 10 }}>{error}</div>
          )}

          <button
            onClick={enabled ? stop : start}
            disabled={pending || !identity}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
              cursor: pending ? 'default' : 'pointer', opacity: pending ? 0.6 : 1,
              background: enabled ? 'transparent' : '#f5a623',
              color: enabled ? '#ef4444' : '#000',
              border: enabled ? '1px solid #ef4444' : 'none',
            }}
          >
            {pending ? 'Working…' : enabled ? 'Stop AI Note Taker' : 'Start AI Note Taker'}
          </button>

          {enabled && (
            <div style={{ marginTop: 12 }}>
              {!note || note.status === 'active' && !note.summaryMarkdown && !note.lastError ? (
                <p style={{ color: '#888', fontSize: 11.5, margin: 0 }}>
                  Listening — your notes will appear here once the meeting's transcript is ready
                  (usually shortly after the meeting ends).
                </p>
              ) : note.lastError ? (
                <p style={{ color: '#ef4444', fontSize: 11.5, margin: 0 }}>
                  Couldn't generate your notes: {note.lastError}
                </p>
              ) : note.summaryMarkdown ? (
                <div style={{ fontSize: 12, color: '#ddd' }}>
                  <LiteMarkdown markdown={note.summaryMarkdown} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </>
  )
}
