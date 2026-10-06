// ============================================================
// NOTETAKER SCREEN — background tab/browser-window minimised UI
// ============================================================
// When a tab (web) or BrowserWindow (Electron) is opened with
// ?room=…&notetaker=fathom, the AI note-taker must connect to the meeting
// like any participant BUT never surface the normal meeting UI. On Electron
// the window is created hidden, so this screen is never seen (it still
// renders the connected, audio-subscribed session). On the web, where a
// tab can't be hidden, this screen replaces the full meeting UI with a
// small, quiet indicator — the correct NT avatar + the note-taker's name,
// so it "shows well" instead of dumping a whole un-attended meeting on the
// user.
// ---------------------------------------------------------------------------

import { Avatar } from './Avatar'

export function NotetakerScreen({ displayName }: { displayName: string }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: "'Roboto', sans-serif",
        userSelect: 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.55 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f5a623' }} />
        <span style={{ fontSize: 13, fontWeight: 500, letterSpacing: 1 }}>BEEHIVE</span>
      </div>

      <div style={{ position: 'relative' }}>
        <Avatar name={displayName} size={56} />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: '50%',
            background: '#48bb78', border: '2px solid #0a0a0a',
          }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{displayName}</div>
        <div style={{ fontSize: 12, color: '#888' }}>AI note-taker — recording this meeting in the background</div>
      </div>
    </div>
  )
}