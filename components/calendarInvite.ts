// Frontend wrapper around the shared iCalendar builder, supplying the browser's
// WEB_BASE and handling the download. The RFC 5545 generation itself lives in
// shared/icsBuilder.js so the backend's /calendar.ics endpoint — the link that
// goes into invite emails — produces byte-identical output from the same code.
import { WEB_BASE } from './roomUtils'
// @ts-expect-error — plain-ESM shared module, intentionally untyped so the
// backend (JS) can import the same file without a build step.
import { buildIcs, toFloatingStamp, icsFilenameFor } from '../shared/icsBuilder.js'

// The minimum a meeting needs to become a calendar event. Deliberately
// structural rather than importing MyMeeting: the carousel passes a MyMeeting
// (which satisfies this shape), while SchedulePanel builds one from its own
// form state right after scheduling — neither caller has to adopt the other's
// type just to download an invite.
export interface CalendarMeeting {
  roomId: string
  roomName: string
  scheduledDate: string | null
  scheduledTime: string | null
  durationMinutes: number | null
  organizerName?: string | null
}

/** True when the meeting has enough data to produce a valid calendar event. */
export function canAddToCalendar(meeting: CalendarMeeting): boolean {
  return !!meeting.scheduledDate && toFloatingStamp(meeting.scheduledDate, meeting.scheduledTime) !== null
}

/** Builds the .ics text for a meeting, or null when it has no usable schedule. */
export function buildMeetingIcs(meeting: CalendarMeeting): string | null {
  return buildIcs({ ...meeting, baseUrl: WEB_BASE })
}

/** Filesystem-safe .ics filename derived from the meeting title. */
export function icsFilename(meeting: CalendarMeeting): string {
  return icsFilenameFor(meeting.roomName)
}

/**
 * Triggers the download. Uses a Blob typed `text/calendar` and an <a download>
 * click — the same mechanism RoomPage already uses for shared-file downloads,
 * so it behaves identically on web and in the Electron renderer.
 */
export function downloadMeetingIcs(meeting: CalendarMeeting): boolean {
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
