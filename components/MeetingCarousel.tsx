import { useState, useEffect, useRef } from 'react'
import { Calendar, Clock, ChevronLeft, ChevronRight, PlayCircle } from 'lucide-react'
import type { MyMeeting } from '../livekit_react_hooks'

export function countdown(date: string, time: string | null): string | null {
  const target = new Date(`${date}T${time || '00:00'}`)
  const diff = target.getTime() - Date.now()
  if (diff < 0) return null
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Starting now'
  if (mins < 60) return `In ${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `In ${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Tomorrow'
  return `In ${days}d`
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
// MeetingCard — informational, no full-width button.
// Gold PlayCircle icon on the right triggers the confirmation sheet.
// Clicking anywhere on the card body selects it.
// -----------------------------------------------------------------------
interface MeetingCardProps {
  meeting: MyMeeting
  selected: boolean
  onSelect: () => void
  onLaunch: () => void
  onAccept: () => void
  onDecline: () => void
  onTentative: () => void
}

function MeetingCard({ meeting, selected, onSelect, onLaunch, onAccept, onDecline, onTentative }: MeetingCardProps) {
  const [cd, setCd] = useState<string | null>(
    meeting.scheduledDate ? countdown(meeting.scheduledDate, meeting.scheduledTime) : null
  )
  const [iconHovered, setIconHovered] = useState(false)
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

  async function handleRsvp(action: () => void) {
    setRsvpPending(true)
    await action()
    setRsvpPending(false)
  }

  return (
    <div
      onClick={onSelect}
      style={{
        width: '100%',
        background: selected ? '#1e1e1e' : '#181818',
        border: `1px solid ${selected ? 'rgba(245,166,35,0.35)' : '#242424'}`,
        borderRadius: 12,
        padding: '13px 14px',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        cursor: 'pointer',
        boxSizing: 'border-box' as const,
        transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
        boxShadow: selected ? '0 0 0 1px rgba(245,166,35,0.15)' : 'none',
      }}
    >
      {/* Left: all text info */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* Header row: role badge + countdown */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
          <span style={{
            fontSize: 9, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' as const,
            color: isOrganizer ? '#f5a623' : '#666',
            fontFamily: "'Roboto', sans-serif",
          }}>
            {isOrganizer ? 'You organised' : `From ${meeting.organizerName}`}
          </span>
          {cd && (
            <span style={{
              fontSize: 9, fontWeight: 600, letterSpacing: 0.4,
              color: isNow ? '#4caf50' : '#f5a623',
              background: isNow ? 'rgba(76,175,80,0.1)' : 'rgba(245,166,35,0.08)',
              border: `1px solid ${isNow ? 'rgba(76,175,80,0.25)' : 'rgba(245,166,35,0.2)'}`,
              borderRadius: 20, padding: '1px 6px',
              fontFamily: "'Roboto', sans-serif", flexShrink: 0,
            }}>
              {cd}
            </span>
          )}
        </div>

        {/* Meeting name */}
        <p style={{
          color: '#fff', fontSize: 13, fontWeight: 300, letterSpacing: 1.2,
          textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif",
          margin: 0, lineHeight: 1.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
        }}>
          {meeting.roomName}
        </p>

        {/* Date/time */}
        {meeting.scheduledDate && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#555', fontSize: 10, fontFamily: "'Roboto', sans-serif" }}>
            <Calendar size={9} />
            {formatWhen(meeting.scheduledDate, meeting.scheduledTime)}
            {meeting.durationMinutes && (
              <>
                <span style={{ color: '#2a2a2a' }}>·</span>
                <Clock size={9} />
                {meeting.durationMinutes < 60
                  ? `${meeting.durationMinutes}m`
                  : `${Math.floor(meeting.durationMinutes / 60)}h${meeting.durationMinutes % 60 ? ` ${meeting.durationMinutes % 60}m` : ''}`}
              </>
            )}
          </div>
        )}

        {/* RSVP status badge */}
        {!isOrganizer && meeting.status && meeting.status !== 'pending' && (
          <span style={{
            alignSelf: 'flex-start',
            fontSize: 9, fontWeight: 600, letterSpacing: 0.5,
            color: STATUS_COLORS[meeting.status],
            background: `${STATUS_COLORS[meeting.status]}15`,
            border: `1px solid ${STATUS_COLORS[meeting.status]}35`,
            borderRadius: 20, padding: '1px 6px',
            fontFamily: "'Roboto', sans-serif",
          }}>
            {STATUS_LABELS[meeting.status]}
          </span>
        )}

        {/* RSVP buttons (pending invitees) */}
        {showRsvp && (
          <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
            <button disabled={rsvpPending} onClick={() => handleRsvp(onAccept)}
              style={{ flex: 1, background: 'rgba(76,175,80,0.08)', border: '1px solid rgba(76,175,80,0.35)', borderRadius: 6, color: '#4caf50', fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1 }}>Accept</button>
            <button disabled={rsvpPending} onClick={() => handleRsvp(onTentative)}
              style={{ flex: 1, background: 'rgba(245,166,35,0.06)', border: '1px solid rgba(245,166,35,0.25)', borderRadius: 6, color: '#f5a623', fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1 }}>Maybe</button>
            <button disabled={rsvpPending} onClick={() => handleRsvp(onDecline)}
              style={{ flex: 1, background: 'none', border: '1px solid #2a2a2a', borderRadius: 6, color: '#444', fontSize: 10, fontWeight: 600, cursor: 'pointer', padding: '4px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1 }}>Decline</button>
          </div>
        )}
      </div>

      {/* Right: gold launch icon — the only action affordance on the card */}
      {meeting.status !== 'declined' && (
        <button
          onClick={e => { e.stopPropagation(); onLaunch() }}
          onMouseEnter={() => setIconHovered(true)}
          onMouseLeave={() => setIconHovered(false)}
          title={isOrganizer ? 'Start meeting' : 'Join meeting'}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: iconHovered ? '#f5a623' : selected ? 'rgba(245,166,35,0.7)' : '#3a3a3a',
            display: 'flex', alignItems: 'center', flexShrink: 0,
            transition: 'color 0.15s, transform 0.15s',
            transform: iconHovered ? 'scale(1.15)' : 'scale(1)',
          }}
        >
          <PlayCircle size={22} strokeWidth={1.5} />
        </button>
      )}
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
  onUpdateStatus: (invitationId: string, status: 'accepted' | 'declined' | 'tentative') => void
}

export function MeetingCarousel({
  meetings, loading, selectedMeetingId, onSelect, onLaunch, onUpdateStatus,
}: MeetingCarouselProps) {
  const [idx, setIdx] = useState(0)

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
        meeting={currentMeeting}
        selected={selectedMeetingId === currentMeeting.roomId}
        onSelect={() => onSelect(currentMeeting)}
        onLaunch={() => { onSelect(currentMeeting); onLaunch(currentMeeting) }}
        onAccept={() => currentMeeting.invitationId && onUpdateStatus(currentMeeting.invitationId, 'accepted')}
        onDecline={() => currentMeeting.invitationId && onUpdateStatus(currentMeeting.invitationId, 'declined')}
        onTentative={() => currentMeeting.invitationId && onUpdateStatus(currentMeeting.invitationId, 'tentative')}
      />
    </div>
  )
}
