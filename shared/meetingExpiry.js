// Scheduled-meeting expiry — the ONE definition of "this meeting is over".
// Imported by BOTH the frontend (components/roomUtils.ts → carousel card,
// lobby primary button, confirm sheet) and the backend (/api/livekit/token),
// same shared-module pattern as icsBuilder.js, so the UI and the server can
// never disagree about whether a meeting may still be joined.
//
// A scheduled meeting stays joinable until its scheduled start + its
// duration (30 min if none was set) + a 10-minute grace, so a call that runs
// long isn't cut off, but a meeting from three days ago is firmly closed.
//
// FLOATING TIME, same caveat as icsBuilder.js: scheduled_date/time carry no
// timezone, so the comparison is made in whichever zone the caller runs in.
// On the server that's UTC; on the client it's the viewer's zone. For a
// meeting hours or days old — the case this exists to stop — the zone
// difference is immaterial. Right at the boundary the client (viewer's
// zone, which is almost always the organiser's) is the better judge and
// the server's window is widened by SERVER_TZ_SLACK_MS so it never rejects
// a join the client just allowed.

export const DEFAULT_DURATION_MIN = 30
export const SCHEDULED_GRACE_MS = 10 * 60 * 1000
// ±14h covers every real-world UTC offset.
export const SERVER_TZ_SLACK_MS = 14 * 60 * 60 * 1000

/**
 * @param {{ scheduledDate?: string|null, scheduledTime?: string|null, durationMinutes?: number|null }} m
 * @param {{ now?: number, slackMs?: number }} [opts]
 */
export function isScheduledMeetingExpired(m, opts = {}) {
  const now = opts.now ?? Date.now()
  const slack = opts.slackMs ?? 0
  if (!m || !m.scheduledDate) return false // undated (Start Now) rooms never expire this way
  const start = new Date(`${m.scheduledDate}T${m.scheduledTime || '00:00'}`).getTime()
  if (Number.isNaN(start)) return false
  const end = start + (m.durationMinutes ?? DEFAULT_DURATION_MIN) * 60 * 1000
  return now > end + SCHEDULED_GRACE_MS + slack
}
