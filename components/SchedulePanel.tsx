import { useState } from 'react'
import { useScheduleRoom } from '../livekit_react_hooks'
import { WEB_BASE, STING_RED, saveMeetingPrep } from './roomUtils'
import { s } from './roomStyles'
import { MeetingPrep, type MeetingPrepSummary } from './MeetingPrep'
import { getTemplate } from './meetingTemplates'
import { TimePicker } from './TimePicker'

const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

// Seeds the BeeHive Bot Assistant's shared, live agenda (meeting_agendas —
// see supabase/migrations/006_meeting_agenda.sql) with whatever prep
// template/agenda was picked at scheduling time, so it's already there the
// instant anyone opens the assistant in the room — not just on whichever
// single device/browser origin happened to schedule the meeting (that's all
// saveMeetingPrep's localStorage ever covered, and Electron's file:// origin
// can never see a web tab's localStorage regardless, so a fix that only
// touched local storage would still leave the desktop app with nothing).
// `template.goals` (labelled "Objectives" in MeetingPrep's own UI) isn't
// part of MeetingPrepSummary/StoredMeetingPrep at all — it's static,
// deterministic from templateId, so it's looked up fresh here rather than
// duplicating it into that existing, working type.
async function seedSharedAgenda(roomId: string, hostSecret: string, organizerName: string, prep: MeetingPrepSummary) {
  const template = getTemplate(prep.templateId)
  try {
    await fetch(`${API_BASE}/api/rooms/${roomId}/agenda`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: prep.title,
        organizerName,
        objectives: template?.goals ?? [],
        items: prep.agenda.map((text, i) => ({ id: `seed-${i}`, text, completed: false, notes: '', order: i })),
        hostSecret,
      }),
    })
  } catch (e) {
    console.error('[schedule] seeding shared agenda failed:', e)
  }
}

const DURATIONS = [15, 30, 45, 60, 90]

export function SchedulePanel({ displayName, onDisplayNameChange, isSting, onScheduled }: {
  displayName: string
  onDisplayNameChange: (v: string) => void
  isSting: boolean
  onScheduled?: (meeting: { name: string; date: string; time: string; link: string }) => void
}) {
  const { scheduleRoom, loading } = useScheduleRoom()
  const [roomName, setRoomName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState(30)
  const [emailInput, setEmailInput] = useState('')
  const [emails, setEmails] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [prep, setPrep] = useState<MeetingPrepSummary | null>(null)
  const [createdRoomId, setCreatedRoomId] = useState<string | null>(null)
  const [createdHostSecret, setCreatedHostSecret] = useState<string | null>(null)

  const addEmail = () => {
    const e = emailInput.trim().toLowerCase()
    if (e && e.includes('@') && !emails.includes(e)) {
      setEmails(prev => [...prev, e])
      setEmailInput('')
    }
  }

  const removeEmail = (e: string) => setEmails(prev => prev.filter(x => x !== e))

  // Shared with sendEmails/onScheduled below so the "next meeting" summary
  // matches whatever name the room was actually created under.
  const meetingName = roomName.trim() || (date ? `Meeting – ${new Date(date + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : 'BeeHive Meeting')

  const handleCreate = async () => {
    if (!displayName.trim()) { alert('Enter your name first'); return }
    // Scheduled meetings go through the backend (not a direct client insert)
    // so they come out waiting-room-gated — only Start Now's own room
    // creation (RoomPage.tsx) stays a direct, ungated client insert.
    const result = await scheduleRoom(meetingName)
    if (!result) return
    const { room, hostSecret } = result
    setLink(`${WEB_BASE}?room=${room.id}`)
    setCreatedRoomId(room.id)
    setCreatedHostSecret(hostSecret)
    // Whatever prep template/checklist/agenda was picked (if any) follows the
    // room in two ways: the existing per-device localStorage copy (read back
    // by MeetingPrepWindow once inside the meeting, same as always), and now
    // also the shared BeeHive Assistant agenda (meeting_agendas), so it's
    // there for every participant regardless of which device/app opens the
    // room, not just this one.
    if (prep) {
      saveMeetingPrep(room.id, prep)
      seedSharedAgenda(room.id, hostSecret, displayName, prep)
    }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sendEmails = () => {
    const subject = encodeURIComponent(`BeeHive Meeting: ${roomName || "You're invited"}`)
    let when = ''
    if (date) {
      const dt = new Date(`${date}T${time || '00:00'}`)
      when = dt.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) })
    }
    const body = encodeURIComponent(
      `Hi,\n\nYou're invited to a BeeHive video meeting.\n\n` +
      (roomName ? `Meeting: ${roomName}\n` : '') +
      (when ? `When: ${when}\n` : '') +
      `\nJoin here:\n${link}\n\n` +
      `— ${displayName || 'Your host'} via BeeHive`
    )
    window.open(`mailto:${emails.join(',')}?subject=${subject}&body=${body}`)
    // Re-save in case the prep selection changed after the room was created
    // but before the invite was sent (both remain editable in between).
    if (prep && createdRoomId) {
      saveMeetingPrep(createdRoomId, prep)
      if (createdHostSecret) seedSharedAgenda(createdRoomId, createdHostSecret, displayName, prep)
    }
    onScheduled?.({ name: meetingName, date, time, link })
  }

  const todayStr = new Date().toISOString().split('T')[0]
  // Prep cards are an aid, not a requirement — only appear once the essentials
  // are filled in, so the user can then choose to use them or ignore them.
  const formReady = displayName.trim() !== '' && date !== '' && time !== ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
      <input
        style={s.input}
        placeholder="Your name"
        value={displayName}
        onChange={e => onDisplayNameChange(e.target.value)}
        autoFocus
      />

      <input
        style={s.input}
        placeholder="Meeting name (optional)"
        value={roomName}
        onChange={e => setRoomName(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="date"
          min={todayStr}
          style={{ ...s.input, flex: 2, margin: 0, colorScheme: 'dark' as any }}
          value={date}
          onChange={e => setDate(e.target.value)}
        />
        <TimePicker value={time} onChange={setTime} style={{ flex: 1 }} />
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ color: '#666', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' as const, flexShrink: 0 }}>Duration</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' as const }}>
          {DURATIONS.map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDuration(d)}
              style={{
                background: duration === d ? '#2a2010' : '#1a1a1a',
                border: `1px solid ${duration === d ? '#f5a623' : '#2a2a2a'}`,
                borderRadius: 16, color: duration === d ? '#f5a623' : '#888',
                fontSize: 12, padding: '5px 12px', cursor: 'pointer', fontFamily: "'Roboto', sans-serif",
              }}
            >
              {d < 60 ? `${d}m` : `${Math.floor(d / 60)}h${d % 60 ? ` ${d % 60}m` : ''}`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={{ ...s.input, flex: 1, margin: 0 }}
          placeholder="Add email address"
          type="email"
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addEmail() } }}
        />
        <button
          style={{ background: '#2a2a2a', border: '1px solid #333', borderRadius: 8, color: '#aaa', padding: '0 14px', cursor: 'pointer', fontSize: 18, flexShrink: 0 }}
          onClick={addEmail}
        >+</button>
      </div>

      {emails.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 6 }}>
          {emails.map(e => (
            <span key={e} style={{ display: 'flex', alignItems: 'center', gap: 5, background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 20, padding: '4px 10px', fontSize: 12, color: '#ccc', fontFamily: "'Roboto', sans-serif" }}>
              {e}
              <button onClick={() => removeEmail(e)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 14 }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Smart Meeting Preparation — meeting-type cards + AI-style prep assistant.
          Only shown once name/date/time are filled in; entirely optional from there. */}
      {formReady && <MeetingPrep durationMinutes={duration} attendeeCount={emails.length} onChange={setPrep} />}

      {link ? (
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ flex: 1, color: '#aaa', fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{link}</span>
            <button onClick={copyLink} style={{ background: copied ? '#1a3a1a' : '#2a2a2a', border: `1px solid ${copied ? '#2d6a2d' : '#333'}`, borderRadius: 6, color: copied ? '#4caf50' : '#aaa', padding: '4px 10px', cursor: 'pointer', fontSize: 11, flexShrink: 0, fontFamily: "'Roboto', sans-serif" }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {emails.length > 0 && (
            <button
              style={{ ...s.primaryBtn, margin: 0, ...(isSting ? { background: STING_RED } : {}) }}
              onClick={sendEmails}
            >
              Send Email Invite{emails.length > 1 ? 's' : ''} ({emails.length})
            </button>
          )}
          {emails.length === 0 && (
            <p style={{ color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", margin: 0, textAlign: 'center' as const }}>
              Add email addresses above to send invites
            </p>
          )}
        </div>
      ) : (
        <button
          style={{
            ...s.primaryBtn, margin: 0,
            ...(isSting ? { background: STING_RED } : {}),
            // Greyed out until the essentials (name/date/time) are filled in —
            // matches the same formReady gate that shows the prep assistant,
            // so the button and the prep cards agree on "ready to schedule".
            ...(!formReady ? { background: '#2a2a2a', color: '#666', cursor: 'not-allowed' } : {}),
          }}
          onClick={handleCreate}
          disabled={loading || !formReady}
          title={!formReady ? 'Enter your name, date, and time first' : undefined}
        >
          {loading ? 'Creating…' : 'Create Meeting & Get Link'}
        </button>
      )}
    </div>
  )
}
