import { useState, useEffect } from 'react'
import { Calendar, Clock, Users, ChevronLeft, ChevronRight } from 'lucide-react'
import type { MyMeeting } from '../livekit_react_hooks'
import { WEB_BASE } from './roomUtils'

// Returns a short human-readable countdown: "In 5m", "In 2h", "Tomorrow", etc.
// Returns null for past meetings or unscheduled ones.
function countdown(date: string, time: string | null): string | null {
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

function formatWhen(date: string, time: string | null): string {
  const dt = new Date(`${date}T${time || '00:00'}`)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  const isToday = dt.toDateString() === today.toDateString()
  const isTomorrow = dt.toDateString() === tomorrow.toDateString()

  const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (!time) return dayLabel
  return `${dayLabel} · ${dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

const STATUS_COLORS: Record<string, string> = {
  pending: '#888',
  accepted: '#4caf50',
  tentative: '#f5a623',
  declined: '#ef4444',
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting reply',
  accepted: 'Going',
  tentative: 'Maybe',
  declined: 'Declined',
}

interface MeetingCardProps {
  meeting: MyMeeting
  onJoin: (roomId: string) => void
  onStart: (roomId: string) => void
  onAccept: () => void
  onDecline: () => void
  onTentative: () => void
}

function MeetingCard({ meeting, onJoin, onStart, onAccept, onDecline, onTentative }: MeetingCardProps) {
  const [cd, setCd] = useState<string | null>(meeting.scheduledDate ? countdown(meeting.scheduledDate, meeting.scheduledTime) : null)
  const [rsvpPending, setRsvpPending] = useState(false)

  // Live countdown — tick every minute
  useEffect(() => {
    if (!meeting.scheduledDate) return
    const tick = () => setCd(countdown(meeting.scheduledDate!, meeting.scheduledTime))
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [meeting.scheduledDate, meeting.scheduledTime])

  const isOrganizer = meeting.role === 'organizer'
  const isNow = cd === 'Starting now' || (meeting.scheduledDate && countdown(meeting.scheduledDate, meeting.scheduledTime) === null && !meeting.endedAt)
  const showRsvp = !isOrganizer && meeting.status === 'pending'

  async function handleRsvp(action: () => void) {
    setRsvpPending(true)
    await action()
    setRsvpPending(false)
  }

  return (
    <div style={{
      minWidth: 268,
      maxWidth: 268,
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: 12,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      flexShrink: 0,
      boxSizing: 'border-box' as const,
    }}>
      {/* Header row: organizer badge + countdown */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' as const,
          color: isOrganizer ? '#f5a623' : '#888',
          fontFamily: "'Roboto', sans-serif",
        }}>
          {isOrganizer ? 'You organised' : `From ${meeting.organizerName}`}
        </span>
        {cd && (
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 0.5, color: isNow ? '#4caf50' : '#f5a623',
            background: isNow ? 'rgba(76,175,80,0.12)' : 'rgba(245,166,35,0.1)',
            border: `1px solid ${isNow ? 'rgba(76,175,80,0.3)' : 'rgba(245,166,35,0.25)'}`,
            borderRadius: 20, padding: '2px 8px',
            fontFamily: "'Roboto', sans-serif",
          }}>
            {cd}
          </span>
        )}
      </div>

      {/* Meeting name */}
      <p style={{
        color: '#fff', fontSize: 14, fontWeight: 300, letterSpacing: 1.5,
        textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif",
        margin: 0, lineHeight: 1.3,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
      }}>
        {meeting.roomName}
      </p>

      {/* Date/time */}
      {meeting.scheduledDate && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#666', fontSize: 11, fontFamily: "'Roboto', sans-serif" }}>
          <Calendar size={10} />
          {formatWhen(meeting.scheduledDate, meeting.scheduledTime)}
          {meeting.durationMinutes && (
            <>
              <span style={{ color: '#333' }}>·</span>
              <Clock size={10} />
              {meeting.durationMinutes < 60 ? `${meeting.durationMinutes}m` : `${Math.floor(meeting.durationMinutes / 60)}h${meeting.durationMinutes % 60 ? ` ${meeting.durationMinutes % 60}m` : ''}`}
            </>
          )}
        </div>
      )}

      {/* RSVP status badge (invitees only, when already replied) */}
      {!isOrganizer && meeting.status && meeting.status !== 'pending' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
            color: STATUS_COLORS[meeting.status],
            background: `${STATUS_COLORS[meeting.status]}18`,
            border: `1px solid ${STATUS_COLORS[meeting.status]}40`,
            borderRadius: 20, padding: '2px 8px',
            fontFamily: "'Roboto', sans-serif",
          }}>
            {STATUS_LABELS[meeting.status]}
          </span>
        </div>
      )}

      {/* RSVP buttons (pending invitees only) */}
      {showRsvp && (
        <div style={{ display: 'flex', gap: 5 }}>
          <button
            disabled={rsvpPending}
            onClick={() => handleRsvp(onAccept)}
            style={{
              flex: 1, background: 'rgba(76,175,80,0.1)', border: '1px solid rgba(76,175,80,0.4)',
              borderRadius: 8, color: '#4caf50', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              padding: '5px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1,
            }}
          >Accept</button>
          <button
            disabled={rsvpPending}
            onClick={() => handleRsvp(onTentative)}
            style={{
              flex: 1, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)',
              borderRadius: 8, color: '#f5a623', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              padding: '5px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1,
            }}
          >Maybe</button>
          <button
            disabled={rsvpPending}
            onClick={() => handleRsvp(onDecline)}
            style={{
              flex: 1, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8, color: '#666', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              padding: '5px 0', fontFamily: "'Roboto', sans-serif", opacity: rsvpPending ? 0.5 : 1,
            }}
          >Decline</button>
        </div>
      )}

      {/* Join / Start button */}
      {meeting.status !== 'declined' && (
        <button
          onClick={() => {
            if (isOrganizer) {
              onStart(meeting.roomId)
            } else {
              onJoin(meeting.roomId)
            }
          }}
          style={{
            background: '#f5a623', color: '#000', border: 'none', borderRadius: 8,
            padding: '9px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            fontFamily: "'Roboto', sans-serif",
          }}
        >
          {isOrganizer ? 'Start Meeting' : 'Join Meeting'}
        </button>
      )}
    </div>
  )
}

interface MeetingCarouselProps {
  meetings: MyMeeting[]
  loading: boolean
  onJoin: (roomId: string) => void
  onStart: (roomId: string) => void
  onUpdateStatus: (invitationId: string, status: 'accepted' | 'declined' | 'tentative') => void
}

export function MeetingCarousel({ meetings, loading, onJoin, onStart, onUpdateStatus }: MeetingCarouselProps) {
  const [idx, setIdx] = useState(0)

  // Clamp index when meetings list shrinks (e.g. decline removes a card)
  const count = meetings.length
  const safeIdx = Math.min(idx, Math.max(0, count - 1))
  if (safeIdx !== idx) setIdx(safeIdx)

  if (loading && count === 0) {
    return (
      <div style={{ color: '#444', fontSize: 11, textAlign: 'center' as const, padding: '10px 0', fontFamily: "'Roboto', sans-serif" }}>
        Loading your meetings…
      </div>
    )
  }

  if (count === 0) return null

  const meeting = meetings[safeIdx]

  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: '#555', fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' as const, fontFamily: "'Roboto', sans-serif" }}>
          Your meetings
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {count > 1 && (
            <>
              <button
                onClick={() => setIdx(i => Math.max(0, i - 1))}
                disabled={safeIdx === 0}
                style={{ background: 'none', border: 'none', cursor: safeIdx === 0 ? 'default' : 'pointer', color: safeIdx === 0 ? '#333' : '#666', padding: 2, display: 'flex' }}
              ><ChevronLeft size={14} /></button>
              <span style={{ color: '#444', fontSize: 10, fontFamily: "'Roboto', sans-serif" }}>{safeIdx + 1}/{count}</span>
              <button
                onClick={() => setIdx(i => Math.min(count - 1, i + 1))}
                disabled={safeIdx === count - 1}
                style={{ background: 'none', border: 'none', cursor: safeIdx === count - 1 ? 'default' : 'pointer', color: safeIdx === count - 1 ? '#333' : '#666', padding: 2, display: 'flex' }}
              ><ChevronRight size={14} /></button>
            </>
          )}
          {count > 1 && (
            <div style={{ display: 'flex', gap: 3, marginLeft: 2 }}>
              {meetings.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setIdx(i)}
                  style={{
                    width: 5, height: 5, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                    background: i === safeIdx ? '#f5a623' : '#333',
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <MeetingCard
        meeting={meeting}
        onJoin={onJoin}
        onStart={onStart}
        onAccept={() => meeting.invitationId && onUpdateStatus(meeting.invitationId, 'accepted')}
        onDecline={() => meeting.invitationId && onUpdateStatus(meeting.invitationId, 'declined')}
        onTentative={() => meeting.invitationId && onUpdateStatus(meeting.invitationId, 'tentative')}
      />
    </div>
  )
}
