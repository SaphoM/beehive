import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, PlayCircle, Trash2, Pencil, CalendarPlus } from 'lucide-react'
import type { MyMeeting } from '../livekit_react_hooks'
import { s, DATE_INPUT_CLASS, DATE_INPUT_CSS, openDatePicker } from './roomStyles'
import { TimePicker } from './TimePicker'
import { canAddToCalendar, downloadMeetingIcs } from './calendarInvite'

const EDIT_DURATIONS = [15, 30, 45, 60, 90]

export function countdown(date: string, time: string | null): string | null {
  const target = new Date(`${date}T${time || '00:00'}`)
  const diff = target.getTime() - Date.now()
  if (diff < 0) return null
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Starting now'
  if (mins < 60) return `In ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `In ${hrs}h`
  // Beyond same-day: label by calendar-date difference, not elapsed hours.
  // Dividing elapsed hours by 24 undercounts whenever the meeting isn't
  // exactly N*24h away (e.g. late tonight to early afternoon two calendar
  // days later is ~36-40 elapsed hours, which floor(hrs/24) reports as
  // "Tomorrow" instead of the correct "In 2 days").
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dayDiff = Math.round((startOfDay(target).getTime() - startOfDay(new Date()).getTime()) / 86400000)
  if (dayDiff === 1) return 'Tomorrow'
  if (dayDiff > 1) return `In ${dayDiff} days`
  return `In ${hrs}h`
}

export function formatWhen(date: string, time: string | null): string {
  const dt = new Date(`${date}T${time || '00:00'}`)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const isToday = dt.toDateString() === today.toDateString()
  const isTomorrow = dt.toDateString() === tomorrow.toDateString()
  const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow'
    : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (!time) return dayLabel
  return `${dayLabel} · ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#888', accepted: '#4caf50', tentative: '#f5a623', declined: '#ef4444',
}
const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting reply', accepted: 'Going', tentative: 'Maybe', declined: 'Declined',
}

// -----------------------------------------------------------------------
// ConfirmSheet — lightweight overlay that appears when the gold icon is
// clicked, or when the primary button is pressed with a meeting selected.
// Lifted to the carousel so it can be portal-free and still stack above
// the card without z-index fights.
// -----------------------------------------------------------------------
interface ConfirmSheetProps {
  meeting: MyMeeting
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmSheet({ meeting, onConfirm, onCancel }: ConfirmSheetProps) {
  const isOrganizer = meeting.role === 'organizer'
  const verb = isOrganizer ? 'Start' : 'Join'

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16,
          padding: '24px 28px', width: 300, display: 'flex', flexDirection: 'column', gap: 16,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          fontFamily: "'Roboto', sans-serif",
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: '#555', fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
            {verb} scheduled meeting
          </span>
          <span style={{
            color: '#fff', fontSize: 15, fontWeight: 300, letterSpacing: 1.5,
            textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            {meeting.roomName}
          </span>
          {meeting.scheduledDate && (
            <span style={{ color: '#f5a623', fontSize: 11, marginTop: 2 }}>
              {formatWhen(meeting.scheduledDate, meeting.scheduledTime)}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={onConfirm}
            style={{
              background: '#f5a623', color: '#000', border: 'none', borderRadius: 10,
              padding: '12px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', width: '100%',
            }}
          >
            {verb} Scheduled Meeting
          </button>
          <button
            onClick={onCancel}
            style={{
              background: '#222', color: '#666', border: '1px solid #2a2a2a', borderRadius: 10,
              padding: '11px 20px', fontSize: 13, cursor: 'pointer', width: '100%',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// EditMeetingSheet — opened from the pencil icon, organizer only. Same
// overlay convention as ConfirmSheet (fixed backdrop, Escape/backdrop-click
// closes) with the exact date/time/duration controls SchedulePanel.tsx
// already uses, so editing a meeting feels identical to scheduling one.
// -----------------------------------------------------------------------
interface EditMeetingSheetProps {
  meeting: MyMeeting
  onSave: (updates: { name: string; scheduledDate: string; scheduledTime: string; durationMinutes: number }) => Promise<{ error: string | null }>
  onCancel: () => void
}

function EditMeetingSheet({ meeting, onSave, onCancel }: EditMeetingSheetProps) {
  const [name, setName] = useState(meeting.roomName)
  const [date, setDate] = useState(meeting.scheduledDate ?? '')
  const [time, setTime] = useState(meeting.scheduledTime ?? '')
  const [duration, setDuration] = useState(meeting.durationMinutes ?? 30)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onCancel() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel, saving])

  const canSave = name.trim() !== '' && date !== '' && time !== '' && !saving

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setErr(null)
    const { error } = await onSave({ name: name.trim(), scheduledDate: date, scheduledTime: time, durationMinutes: duration })
    setSaving(false)
    if (error) setErr(error)
    else onCancel() // success — the parent's refetch already updated the card, just close
  }

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div
      onClick={() => !saving && onCancel()}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 16,
          padding: '24px 28px', width: 320, display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          fontFamily: "'Roboto', sans-serif",
        }}
      >
        <span style={{ color: '#555', fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>
          Edit scheduled meeting
        </span>

        <input
          style={s.input}
          placeholder="Meeting name"
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />

        {/* Same treatment as SchedulePanel's date field: the native calendar
            indicator is otherwise a near-black glyph on a dark input, and only
            the glyph itself opened the picker. The CSS is shared because these
            two components never mount together (Schedule tab vs Start Now). */}
        <style>{DATE_INPUT_CSS}</style>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="date"
            className={DATE_INPUT_CLASS}
            min={todayStr}
            style={{ ...s.input, flex: 2, margin: 0 }}
            value={date}
            onChange={e => setDate(e.target.value)}
            onClick={openDatePicker}
          />
          <TimePicker value={time} onChange={setTime} style={{ flex: 1 }} selectedDate={date || undefined} />
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
          <span style={{ color: '#666', fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase' as const, flexShrink: 0 }}>Duration</span>
          {EDIT_DURATIONS.map(d => (
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

        {err && (
          <p style={{ color: '#ef4444', fontSize: 11, margin: 0 }}>{err}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              background: canSave ? '#f5a623' : '#2a2a2a', color: canSave ? '#000' : '#666', border: 'none', borderRadius: 10,
              padding: '12px 20px', fontSize: 13, fontWeight: 600, cursor: canSave ? 'pointer' : 'default', width: '100%',
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              background: '#222', color: '#666', border: '1px solid #2a2a2a', borderRadius: 10,
              padding: '11px 20px', fontSize: 13, cursor: saving ? 'default' : 'pointer', width: '100%',
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// MeetingCard — informational, no full-width button.
// Gold PlayCircle icon on the right triggers the confirmation sheet.
// Clicking anywhere on the card body selects it.
// -----------------------------------------------------------------------
interface MeetingCardProps {
  meeting: MyMeeting
  selected: boolean
  onSelect: () => void
  onLaunch: () => void
  onEdit: () => void
  onDelete: () => void
  onAccept: () => void
  onDecline: () => void
  onTentative: () => void
}

function MeetingCard({ meeting, selected, onSelect, onLaunch, onEdit, onDelete, onAccept, onDecline, onTentative }: MeetingCardProps) {
  const [cd, setCd] = useState<string | null>(
    meeting.scheduledDate ? countdown(meeting.scheduledDate, meeting.scheduledTime) : null
  )
  const [iconHovered, setIconHovered] = useState(false)
  const [editHovered, setEditHovered] = useState(false)
  const [trashHovered, setTrashHovered] = useState(false)
  const [calHovered, setCalHovered] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [rsvpPending, setRsvpPending] = useState(false)

  useEffect(() => {
    if (!meeting.scheduledDate) return
    const tick = () => setCd(countdown(meeting.scheduledDate!, meeting.scheduledTime))
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [meeting.scheduledDate, meeting.scheduledTime])

  const isOrganizer = meeting.role === 'organizer'
  const isNow = cd === 'Starting now'
  const showRsvp = !isOrganizer && meeting.status === 'pending'

  // Grey out the launch icon 10 minutes after the scheduled time has passed
  const isExpired = (() => {
    if (!meeting.scheduledDate) return false
    const target = new Date(`${meeting.scheduledDate}T${meeting.scheduledTime || '00:00'}`)
    return Date.now() > target.getTime() + 10 * 60 * 1000
  })()

  async function handleRsvp(action: () => void) {
    setRsvpPending(true)
    await action()
    setRsvpPending(false)
  }

  // Build the gold meta line — mirrors the "1 participant in the room" line
  // from the invite preview card. Shows date/time + countdown, or RSVP status.
  const metaParts: string[] = []
  if (meeting.scheduledDate) {
    metaParts.push(formatWhen(meeting.scheduledDate, meeting.scheduledTime))
    if (meeting.durationMinutes) {
      metaParts.push(
        meeting.durationMinutes < 60
          ? `${meeting.durationMinutes}m`
          : `${Math.floor(meeting.durationMinutes / 60)}h${meeting.durationMinutes % 60 ? ` ${meeting.durationMinutes % 60}m` : ''}`
      )
    }
  }
  if (cd) metaParts.push(cd)
  if (!isOrganizer && meeting.status && meeting.status !== 'pending') {
    metaParts.push(STATUS_LABELS[meeting.status])
  }

  return (
    <div
      onClick={onSelect}
      style={{
        ...s.invitePreview,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        // Subtle gold border when selected — same card, just focused
        border: selected ? '1px solid rgba(245,166,35,0.4)' : '1px solid #2a2a2a',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Text block — identical hierarchy to the invite preview */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <p style={s.inviteLabel}>
          {isOrganizer ? 'You organised' : `From ${meeting.organizerName}`}
        </p>
        <p style={{ ...s.inviteRoomName, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {meeting.roomName}
        </p>
        {metaParts.length > 0 && (
          <p style={{ ...s.inviteMeta, color: isNow ? '#4caf50' : '#f5a623' }}>
            {metaParts.join(' · ')}
          </p>
        )}

        {/* Inline RSVP buttons for pending invitees */}
        {showRsvp && (
          <div style={{ display: 'flex', gap: 4, marginTop: 4 }} onClick={e => e.stopPropagation()}>
            <button disabled={rsvpPending} onClick={() => handleRsvp(onAccept)}
              style={{ flex: 1, background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.35)', borderRadius: 6, color: '#4caf50', fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1 }}>Accept</button>
            <button disabled={rsvpPending} onClick={() => handleRsvp(onTentative)}
              style={{ flex: 1, background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 6, color: '#f5a623', fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1 }}>Maybe</button>
            <button disabled={rsvpPending} onClick={() => handleRsvp(onDecline)}
              style={{ flex: 1, background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#444', fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1 }}>Decline</button>
          </div>
        )}
      </div>

      {/* Right-side action column */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>

        {/* Edit icon — organizer only, hidden while the delete-confirm row is showing to avoid a cramped/ambiguous action column */}
        {isOrganizer && !confirmDelete && (
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            onMouseEnter={() => setEditHovered(true)}
            onMouseLeave={() => setEditHovered(false)}
            title="Edit meeting"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: editHovered ? '#f5a623' : '#333',
              display: 'flex', alignItems: 'center',
              transition: 'color 0.15s, transform 0.15s',
              transform: editHovered ? 'scale(1.15)' : 'scale(1)',
            }}
          >
            <Pencil size={13} strokeWidth={1.5} />
          </button>
        )}

        {/* Add to Calendar — available to organiser and invitee alike; hidden
            when the meeting has no usable scheduled date. Downloads an .ics
            built from this meeting's own data (see calendarInvite.ts). */}
        {canAddToCalendar(meeting) && (
          <button
            onClick={e => { e.stopPropagation(); downloadMeetingIcs(meeting) }}
            onMouseEnter={() => setCalHovered(true)}
            onMouseLeave={() => setCalHovered(false)}
            title="Add to calendar"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: calHovered ? '#f5a623' : '#333',
              display: 'flex', alignItems: 'center',
              transition: 'color 0.15s, transform 0.15s',
              transform: calHovered ? 'scale(1.15)' : 'scale(1)',
            }}
          >
            <CalendarPlus size={13} strokeWidth={1.5} />
          </button>
        )}

        {/* Trash icon — organizer only */}
        {isOrganizer && !confirmDelete && (
          <button
            onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
            onMouseEnter={() => setTrashHovered(true)}
            onMouseLeave={() => setTrashHovered(false)}
            title="Delete meeting"
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: trashHovered ? '#ef4444' : '#333',
              display: 'flex', alignItems: 'center',
              transition: 'color 0.15s, transform 0.15s',
              transform: trashHovered ? 'scale(1.15)' : 'scale(1)',
            }}
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </button>
        )}

        {/* Inline delete confirm */}
        {isOrganizer && confirmDelete && (
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setConfirmDelete(false); onDelete() }}
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 5, color: '#ef4444', fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: '3px 7px', fontFamily: "'Roboto', sans-serif" }}
            >Delete</button>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ background: 'none', border: '1px solid #2a2a2a', borderRadius: 5, color: '#555', fontSize: 10, cursor: 'pointer', padding: '3px 7px', fontFamily: "'Roboto', sans-serif" }}
            >Keep</button>
          </div>
        )}

        {/* Gold PlayCircle — the only launch affordance */}
        {meeting.status !== 'declined' && (
          <button
            onClick={e => { e.stopPropagation(); if (!isExpired) onLaunch() }}
            onMouseEnter={() => { if (!isExpired) setIconHovered(true) }}
            onMouseLeave={() => setIconHovered(false)}
            title={isExpired ? 'Meeting time has passed' : isOrganizer ? 'Start meeting' : 'Join meeting'}
            disabled={isExpired}
            style={{
              background: 'none', border: 'none', padding: 0,
              cursor: isExpired ? 'not-allowed' : 'pointer',
              color: isExpired ? '#2e2e2e' : iconHovered ? '#f5a623' : selected ? 'rgba(245,166,35,0.6)' : '#333',
              display: 'flex', alignItems: 'center',
              transition: 'color 0.15s, transform 0.15s',
              transform: !isExpired && iconHovered ? 'scale(1.18)' : 'scale(1)',
            }}
          >
            <PlayCircle size={22} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------
// MeetingCarousel — exported. Manages index and selection only.
// Confirmation lives in Lobby so the primary button can also trigger it.
// -----------------------------------------------------------------------
interface MeetingCarouselProps {
  meetings: MyMeeting[]
  loading: boolean
  selectedMeetingId: string | null
  onSelect: (meeting: MyMeeting | null) => void
  /** Called when the gold icon is clicked — Lobby opens the confirm sheet */
  onLaunch: (meeting: MyMeeting) => void
  onDelete: (meeting: MyMeeting) => void
  /** Persists the edit; the carousel owns the sheet itself since — unlike
      launch/delete — editing doesn't need to coordinate with Lobby's
      primary button or a second confirm step. */
  onEdit: (meeting: MyMeeting, updates: { name: string; scheduledDate: string; scheduledTime: string; durationMinutes: number }) => Promise<{ error: string | null }>
  onUpdateStatus: (invitationId: string, status: 'accepted' | 'declined' | 'tentative') => void
}

export function MeetingCarousel({
  meetings, loading, selectedMeetingId, onSelect, onLaunch, onDelete, onEdit, onUpdateStatus,
}: MeetingCarouselProps) {
  const [idx, setIdx] = useState(0)
  const [editingMeeting, setEditingMeeting] = useState<MyMeeting | null>(null)

  const count = meetings.length
  const safeIdx = Math.min(idx, Math.max(0, count - 1))
  if (safeIdx !== idx) setIdx(safeIdx)

  // Auto-select the visible card so the primary button label stays in sync
  useEffect(() => {
    if (count > 0) onSelect(meetings[safeIdx])
    else onSelect(null)
  }, [safeIdx, count]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && count === 0) return (
    <div style={{ color: '#444', fontSize: 11, textAlign: 'center' as const, padding: '8px 0', fontFamily: "'Roboto', sans-serif" }}>
      Loading your meetings…
    </div>
  )
  if (count === 0) return null

  const currentMeeting = meetings[safeIdx]

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
      {/* Header: label + pagination dots */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#444', fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif" }}>
          Your meetings
        </span>
        {count > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => setIdx(i => Math.max(0, i - 1))}
              disabled={safeIdx === 0}
              style={{ background: 'none', border: 'none', cursor: safeIdx === 0 ? 'default' : 'pointer', color: safeIdx === 0 ? '#2a2a2a' : '#555', padding: 2, display: 'flex' }}
            ><ChevronLeft size={13} /></button>
            <div style={{ display: 'flex', gap: 3 }}>
              {meetings.map((_, i) => (
                <button key={i} onClick={() => setIdx(i)} style={{
                  width: 4, height: 4, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                  background: i === safeIdx ? '#f5a623' : '#2a2a2a',
                }} />
              ))}
            </div>
            <button
              onClick={() => setIdx(i => Math.min(count - 1, i + 1))}
              disabled={safeIdx === count - 1}
              style={{ background: 'none', border: 'none', cursor: safeIdx === count - 1 ? 'default' : 'pointer', color: safeIdx === count - 1 ? '#2a2a2a' : '#555', padding: 2, display: 'flex' }}
            ><ChevronRight size={13} /></button>
          </div>
        )}
      </div>

      <MeetingCard
        key={currentMeeting.roomId}
        meeting={currentMeeting}
        selected={selectedMeetingId === currentMeeting.roomId}
        onSelect={() => onSelect(currentMeeting)}
        onLaunch={() => { onSelect(currentMeeting); onLaunch(currentMeeting) }}
        onEdit={() => setEditingMeeting(currentMeeting)}
        onDelete={() => onDelete(currentMeeting)}
        onAccept={() => currentMeeting.invitationId && onUpdateStatus(currentMeeting.invitationId, 'accepted')}
        onDecline={() => currentMeeting.invitationId && onUpdateStatus(currentMeeting.invitationId, 'declined')}
        onTentative={() => currentMeeting.invitationId && onUpdateStatus(currentMeeting.invitationId, 'tentative')}
      />

      {editingMeeting && (
        <EditMeetingSheet
          meeting={editingMeeting}
          onSave={updates => onEdit(editingMeeting, updates)}
          onCancel={() => setEditingMeeting(null)}
        />
      )}
    </div>
  )
}
