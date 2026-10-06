// Shared RFC 5545 iCalendar builder — imported by BOTH the frontend
// (components/calendarInvite.ts, for the "Add to Calendar" buttons) and the
// backend (livekit_node_backend.js, for the /calendar.ics link that goes in
// invite emails). Kept dependency-free plain ESM so both can consume it.
//
// One source of truth on purpose: escaping and line-folding rules are fiddly
// enough that two copies would drift, and a divergence would mean the invite a
// recipient gets differs from the one the organiser downloaded.
//
// FLOATING TIME, deliberately. rooms.scheduled_date and scheduled_time are
// plain text columns with no timezone and no UTC offset stored, so the zone the
// organiser scheduled in is genuinely not recorded. Rather than guess one
// (which would silently shift the meeting for whoever it guessed wrong for),
// times are emitted as RFC 5545 "floating" date-times: no Z, no TZID. A
// floating event shows the same wall-clock time in every timezone — 12:00 stays
// 12:00 — matching what BeeHive itself displays, since the app renders these
// strings without conversion.

// RFC 5545 §3.3.11: backslash, semicolon and comma are escaped; newlines become
// a literal \n. Carriage returns are normalised first so CRLF input can't
// produce a stray escape.
export function escapeText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n?/g, '\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

// RFC 5545 §3.1: content lines fold at 75 OCTETS, continuation lines beginning
// with a single space. Octets, not characters — so a multi-byte character (an
// accented name, an emoji in a title) must not be split across the boundary.
export function foldLine(line) {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line

  const out = []
  let current = ''
  let currentBytes = 0
  let first = true

  for (const char of line) {
    const charBytes = encoder.encode(char).length
    const limit = first ? 75 : 74 // continuation lines carry a leading space
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

// "2026-08-19" + "12:00" -> "20260819T120000" (floating). null when unparseable,
// so callers can decline rather than emit a malformed event.
export function toFloatingStamp(date, time) {
  if (!date) return null
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date).trim())
  if (!dateMatch) return null
  const [, y, m, d] = dateMatch

  let hh = '00'
  let mm = '00'
  if (time) {
    const timeMatch = /^(\d{1,2}):(\d{2})/.exec(String(time).trim())
    if (!timeMatch) return null
    hh = timeMatch[1].padStart(2, '0')
    mm = timeMatch[2]
    if (Number(hh) > 23 || Number(mm) > 59) return null
  }
  return `${y}${m}${d}T${hh}${mm}00`
}

// Adds minutes without going through local-time Date parsing — Date would
// interpret the value in the *runtime's* zone and could shift it across a DST
// boundary, which is exactly what floating time exists to avoid. Date.UTC is
// used purely as calendar arithmetic.
export function addMinutes(stamp, minutes) {
  const y = Number(stamp.slice(0, 4))
  const mo = Number(stamp.slice(4, 6))
  const d = Number(stamp.slice(6, 8))
  const h = Number(stamp.slice(9, 11))
  const mi = Number(stamp.slice(11, 13))

  const end = new Date(Date.UTC(y, mo - 1, d, h, mi, 0) + minutes * 60_000)
  const p = n => String(n).padStart(2, '0')
  return (
    `${end.getUTCFullYear()}${p(end.getUTCMonth() + 1)}${p(end.getUTCDate())}` +
    `T${p(end.getUTCHours())}${p(end.getUTCMinutes())}00`
  )
}

/**
 * Builds .ics text, or null when the meeting has no usable schedule.
 *
 * ORGANIZER and ATTENDEE are omitted deliberately: both require a CAL-ADDRESS
 * (a mailto: URI) and only a display name is available here. Inventing an
 * address would misattribute the meeting, so the organiser's name goes in
 * DESCRIPTION. METHOD is PUBLISH rather than REQUEST for the same reason —
 * REQUEST is an iTIP invitation, meaningless without an organiser address.
 */
export function buildIcs({ roomId, roomName, scheduledDate, scheduledTime, durationMinutes, organizerName, baseUrl }) {
  const start = toFloatingStamp(scheduledDate, scheduledTime)
  if (!start) return null

  const end = addMinutes(start, durationMinutes ?? 30)
  const joinUrl = `${String(baseUrl || '').replace(/\/$/, '')}?room=${roomId}`

  // Stable per meeting: re-downloading after an edit updates the existing
  // calendar entry instead of creating a duplicate. roomId is the same opaque
  // UUID already present in the shareable join link, so nothing new is exposed.
  const uid = `meeting-${roomId}@beehive.xspark.co.za`

  // DTSTAMP is when the file was produced and is always UTC per RFC 5545 —
  // unrelated to the floating event times above.
  const dtstamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

  const description = [
    `Join the meeting: ${joinUrl}`,
    organizerName ? `Organiser: ${organizerName}` : null,
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
    `SUMMARY:${escapeText(roomName || 'BeeHive meeting')}`,
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
export function icsFilenameFor(roomName) {
  const base = String(roomName || 'BeeHive-meeting')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${base || 'BeeHive-meeting'}.ics`
}
