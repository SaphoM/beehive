// Generates an RFC 5545 iCalendar (.ics) file for a scheduled BeeHive meeting,
// so an attendee can add it to Google Calendar / Outlook / Apple Calendar.
//
// Built entirely from data the carousel has already loaded (MyMeeting) — no new
// endpoint, no second meeting record, no second scheduling source. DTEND is
// derived from the meeting's own durationMinutes so BeeHive and the calendar
// event cannot disagree.
//
// FLOATING TIME, deliberately. `rooms.scheduled_date` and `rooms.scheduled_time`
// are plain `text` columns with no timezone and no UTC offset stored anywhere,
// so the zone the organiser scheduled in is genuinely not recorded. Rather than
// guess one (which would silently shift the meeting for anyone it guessed wrong
// for), these are emitted as RFC 5545 "floating" date-times: no `Z`, no `TZID`.
// A floating event displays at the same wall-clock time in every timezone —
// 12:00 stays 12:00 — which matches what every BeeHive user currently sees,
// since the app itself renders these strings without conversion.
//
// The trade-off, stated plainly: for attendees in different timezones this is
// wall-clock-correct but not instant-correct. Fixing that properly requires
// storing the organiser's timezone on the room, which is a schema change.
import type { MyMeeting } from '../livekit_react_hooks'
import { WEB_BASE } from './roomUtils'

// RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become
// a literal \n. Carriage returns are normalised away first so CRLF input can't
// produce a stray escape.
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?/g, '\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// RFC 5545 §3.1: content lines are folded at 75 octets, continuation lines
// beginning with a single space. Folding counts OCTETS, not characters, so a
// multi-byte character (an accented name, an emoji in a meeting title) must not
// be split across the boundary — hence measuring with TextEncoder and folding
// on whole code points.
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out: string[] = []
  let current = ''
  let currentBytes = 0
  let first = true

  for (const char of line) {
    const charBytes = encoder.encode(char).length
    // Continuation lines carry a leading space, so their budget is 74.
    const limit = first ? 75 : 74
    if (currentBytes + charBytes > limit) {
      out.push(current)
      first = false
      current = char
      currentBytes = charBytes
    } else {
      current += char
      currentBytes += charBytes
    }
  }
  out.push(current)
  return out.join('\r\n ')
}

// "2026-08-19" + "12:00" -> "20260819T120000" (floating: no Z, no TZID).
// Returns null when the date is missing or unparseable, so callers can hide the
// action rather than emit a malformed event.
function toFloatingStamp(date: string, time: string | null): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  if (!dateMatch) return null
  const [, y, m, d] = dateMatch

  let hh = '00'
  let mm = '00'
  if (time) {
    const timeMatch = /^(\d{1,2}):(\d{2})/.exec(time.trim())
    if (!timeMatch) return null
    hh = timeMatch[1].padStart(2, '0')
    mm = timeMatch[2]
    if (Number(hh) > 23 || Number(mm) > 59) return null
  }
  return `${y}${m}${d}T${hh}${mm}00`
}

// Adds `minutes` to a floating stamp without going through Date's timezone
// handling — Date would interpret the value in the *viewer's* zone and could
// shift it across a DST boundary, which is exactly what floating time exists to
// avoid. Uses a UTC-based Date purely as calendar arithmetic.
function addMinutes(stamp: string, minutes: number): string {
  const y = Number(stamp.slice(0, 4))
  const mo = Number(stamp.slice(4, 6))
  const d = Number(stamp.slice(6, 8))
  const h = Number(stamp.slice(9, 11))
  const mi = Number(stamp.slice(11, 13))

  const base = Date.UTC(y, mo - 1, d, h, mi, 0)
  const end = new Date(base + minutes * 60_000)

  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${end.getUTCFullYear()}${p(end.getUTCMonth() + 1)}${p(end.getUTCDate())}` +
    `T${p(end.getUTCHours())}${p(end.getUTCMinutes())}00`
  )
}

/** True when the meeting has enough data to produce a valid calendar event. */
export function canAddToCalendar(meeting: MyMeeting): boolean {
  return !!meeting.scheduledDate && toFloatingStamp(meeting.scheduledDate, meeting.scheduledTime) !== null
}

/**
 * Builds the .ics text for a meeting, or null when it has no usable schedule.
 *
 * ORGANIZER and ATTENDEE are deliberately omitted: both require a CAL-ADDRESS
 * (a mailto: URI), and MyMeeting carries only the organiser's display name —
 * no email. Inventing an address would misattribute the meeting, so the
 * organiser's name goes in DESCRIPTION instead. METHOD:PUBLISH (not REQUEST)
 * for the same reason: REQUEST is an iTIP invitation, which is meaningless
 * without an organiser address and a mail transport.
 */
export function buildMeetingIcs(meeting: MyMeeting): string | null {
  if (!meeting.scheduledDate) return null
  const start = toFloatingStamp(meeting.scheduledDate, meeting.scheduledTime)
  if (!start) return null

  const end = addMinutes(start, meeting.durationMinutes ?? 30)
  const joinUrl = `${WEB_BASE}?room=${meeting.roomId}`

  // Stable per meeting (§13): re-downloading after an edit updates the existing
  // calendar entry instead of creating a duplicate. roomId is the same opaque
  // UUID already present in the shareable join link, so this exposes nothing new.
  const uid = `meeting-${meeting.roomId}@beehive.xspark.co.za`

  // DTSTAMP is when the file was produced and is always UTC per RFC 5545 —
  // unrelated to the floating event times above.
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  const description = [
    `Join the meeting: ${joinUrl}`,
    meeting.organizerName ? `Organiser: ${meeting.organizerName}` : null,
  ].filter(Boolean).join('\n')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//X Spark//BeeHive//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${escapeText(meeting.roomName || 'BeeHive meeting')}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(joinUrl)}`,
    `URL:${escapeText(joinUrl)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  // RFC 5545 requires CRLF terminators, including a trailing one.
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** Filesystem-safe .ics filename derived from the meeting title. */
export function icsFilename(meeting: MyMeeting): string {
  const base = (meeting.roomName || 'BeeHive-meeting')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${base || 'BeeHive-meeting'}.ics`
}

/**
 * Triggers the download. Uses a Blob typed `text/calendar` and an <a download>
 * click — the same mechanism RoomPage already uses for shared-file downloads,
 * so it behaves identically on web and in the Electron renderer.
 */
export function downloadMeetingIcs(meeting: MyMeeting): boolean {
  const ics = buildMeetingIcs(meeting)
  if (!ics) return false

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = icsFilename(meeting)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoked on the next tick so the click has already been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
