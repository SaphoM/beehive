import express from 'express'
import { AccessToken, RoomServiceClient, TrackSource, EgressClient, WebhookReceiver } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { createMeetingIntelligence } from './meetingIntelligence.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

dotenv.config()

const app = express()

// ============================================================
// SECURITY HEADERS
// Render's declarative `headers:` block in render.yaml only applies to
// *static site* services — this is a `runtime: node` web service with a
// custom startCommand, so headers must be set by the app itself. (Earlier
// attempts at these headers lived in render.yaml / a Netlify _headers file,
// neither of which this Node/Render deploy ever actually applies — hence
// the site scoring an F despite that history.)
// ============================================================
app.use((_req, res, next) => {
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader(
    'Permissions-Policy',
    'camera=(self), microphone=(self), display-capture=(self), fullscreen=(self), geolocation=(), payment=(), usb=()'
  )
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // cdn.jsdelivr.net: legacy MediaPipe Selfie Segmentation <script> loader
      // (components/roomUtils.ts's ensureMediaPipe) and the Tasks Vision WASM
      // runtime fetch; 'wasm-unsafe-eval' is required to instantiate that WASM.
      "script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'",
      // MediaPipe's GPU-delegated inference can spin up Workers from blob URLs.
      "worker-src 'self' blob:",
      // Inline <style> blocks (RoomPage.tsx/Toast.tsx use `<style>{...}</style>`
      // for keyframes/hover rules) require 'unsafe-inline' here — style-src
      // 'unsafe-inline' cannot execute script, so this is a low-risk allowance.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // data:: desktopCapturer thumbnails (base64); blob:: local media/canvas;
      // https://*.supabase.co: avatar images and shared-file previews, both
      // served as public Supabase Storage URLs (uploadAvatar() in
      // components/Avatar.tsx, the shared-files bucket in RoomPage.tsx's file
      // share). Missing here on web only, never on desktop (Electron loads via
      // file://, so this CSP header — set by Express, an HTTP response header
      // — is never applied to it at all) is exactly why an uploaded avatar
      // rendered on desktop but silently fell back to initials on web: the
      // browser blocked the <img> load outright per its own CSP, no error
      // surfaced anywhere in this app's own code because there was nothing
      // for this app to catch — CSP violations are enforced and logged by the
      // browser itself, before the image request is even attempted.
      "img-src 'self' data: blob: https://*.supabase.co",
      "media-src 'self' blob:",
      // Supabase (DB/Realtime/Storage) + LiveKit Cloud (signaling) + MediaPipe
      // asset hosts. WebRTC media itself (audio/video) isn't gated by connect-src.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://cdn.jsdelivr.net https://storage.googleapis.com",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ')
  )
  next()
})

// The `verify` callback stashes the raw request body alongside Express's
// already-parsed req.body — added solely so the new webhook signature
// verification below (WebhookReceiver.receive()) has the exact raw string
// LiveKit signed. Every existing route's req.body is completely unaffected;
// this only attaches a new req.rawBody Buffer nothing previously read.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role for server-side operations
)

// Server-side moderation (force-mute) requires LiveKit's Room Service API —
// the browser client SDK has no ability to mute another participant's track
// at all, by design (a client can only control its own tracks). This is the
// only client already instantiated with the API key/secret elsewhere in this
// file (AccessToken, below), reused here for the same credentials.
// LIVEKIT_URL falls back to VITE_LIVEKIT_URL (already provisioned in
// production — see render.yaml) since RoomServiceClient accepts the same
// ws(s):// host the browser SDK uses and converts it to http(s) internally.
const roomService = new RoomServiceClient(
  process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
)

// Server-side recording for the opt-in Meeting Intelligence pipeline (see
// meetingIntelligence.js) — same credentials as roomService above, LiveKit
// Cloud runs the actual Egress infrastructure so no separate worker is
// needed here, just this API client.
const egressClient = new EgressClient(
  process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL,
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET
)

// Verifies the /api/livekit/webhook request actually came from LiveKit
// (Authorization header, signed JWT) before any of its branches act on the
// payload — added specifically because the new room_started/room_finished/
// egress_ended branches below now trigger paid, stateful actions (starting/
// stopping egress, writing job rows) from this payload, unlike the
// pre-existing read-mostly branches. Every genuine LiveKit webhook call
// already carries a valid signature and continues to pass identically.
const webhookReceiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)

const meetingIntelligence = createMeetingIntelligence({ supabase, egressClient })

// ============================================================
// SCHEDULE A ROOM (waiting-room-gated — Schedule tab only)
// POST /api/rooms/schedule
// Body: { name, organisation }
// ============================================================
// Distinct from the client-side useCreateRoom() insert Start Now still uses
// directly — that path stays exactly as frictionless as it is today
// (requires_admission defaults false on a direct client insert). This one
// mints a host_secret server-side, in a table with zero client grants (see
// migration 004), and is the only way a room ends up with
// requires_admission: true. The secret is returned once, in this response,
// and never touches any client-readable table — SchedulePanel.tsx stores it
// in localStorage, and it rides back to this backend on every subsequent
// token request for this room to prove host identity.
app.post('/api/rooms/schedule', async (req, res) => {
  const { name, organisation, accessToken, scheduledDate, scheduledTime, durationMinutes } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const livekitRoomName = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  // If the organizer is signed in, record it as a fallback host-recognition
  // path (see /api/livekit/token below) alongside the existing host_secret —
  // the secret only lives in the one browser that scheduled the meeting, so
  // an organizer opening their own invite link from a different device/
  // browser previously landed in the waiting room with no way in. Verified
  // via Supabase's own token check (not trusted from the request body raw),
  // so this can't be spoofed with someone else's user id. Best-effort: an
  // invalid/expired token or an anonymous scheduler just leaves this null,
  // exactly as it already behaves today.
  // scheduler_auth_user_id, NOT the pre-existing created_by column — that
  // one FKs to the legacy public.users table, not auth.users, so writing a
  // real session's user.id there would violate its FK for any user without
  // a matching public.users row (the exact landmine room_participants.
  // user_id already hit, fixed there via its own auth_user_id bridge
  // column — same fix shape, new column, here).
  let schedulerAuthUserId = null
  if (accessToken) {
    const { data: { user } } = await supabase.auth.getUser(accessToken)
    schedulerAuthUserId = user?.id ?? null
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .insert({
      name,
      livekit_room_name: livekitRoomName,
      organisation,
      requires_admission: true,
      scheduler_auth_user_id: schedulerAuthUserId,
      ...(scheduledDate ? { scheduled_date: scheduledDate } : {}),
      ...(scheduledTime ? { scheduled_time: scheduledTime } : {}),
      ...(durationMinutes ? { duration_minutes: durationMinutes } : {}),
    })
    .select()
    .single()

  if (roomError || !room) {
    console.error('[schedule] room insert failed:', roomError?.message)
    return res.status(500).json({ error: 'Failed to create room' })
  }

  const hostSecret = randomUUID()
  const { error: hostError } = await supabase.from('room_hosts').insert({ room_id: room.id, host_secret: hostSecret })
  if (hostError) {
    console.error('[schedule] room_hosts insert failed:', hostError.message)
    return res.status(500).json({ error: 'Failed to provision host' })
  }

  return res.json({ room, hostSecret })
})

// ============================================================
// GENERATE LIVEKIT TOKEN
// POST /api/livekit/token
// Body: { roomName, displayName, identity, hostSecret? }
// ============================================================
app.post('/api/livekit/token', async (req, res) => {
  const { roomName, displayName, identity, hostSecret, accessToken } = req.body

  if (!roomName || !displayName) {
    return res.status(400).json({ error: 'roomName and displayName are required' })
  }

  // Identity must be unique per participant connection — LiveKit silently
  // disconnects the earlier participant whenever a second one joins the same
  // room with an identity already in use. Display names are freeform and
  // often collide (two people typing "Guest", or two tabs sharing the same
  // logged-in profile's name), which was replacing/kicking earlier
  // participants and looking like "their mic doesn't work". The client
  // generates a random identity per join; this falls back to displayName
  // only for older clients that don't send one.
  const participantIdentity = identity || displayName

  // Waiting-room gate — only applies to rooms scheduled via /api/rooms/schedule
  // (requires_admission: true). Start Now and pre-existing scheduled rooms
  // fall through untouched, exactly as before this feature existed.
  const { data: room } = await supabase
    .from('rooms')
    .select('id, requires_admission, scheduler_auth_user_id')
    .eq('livekit_room_name', roomName)
    .single()

  if (room?.requires_admission) {
    let isHost = false
    if (hostSecret) {
      const { data: hostRow } = await supabase
        .from('room_hosts')
        .select('host_secret')
        .eq('room_id', room.id)
        .single()
      isHost = hostRow?.host_secret === hostSecret
    }
    // Fallback for the organizer opening their own invite link on a
    // different browser/device than the one they scheduled from — the
    // host_secret above only ever exists in that one browser's localStorage.
    // Verified via Supabase's own token check, so a client can't just claim
    // to be any user id here.
    if (!isHost && accessToken && room.scheduler_auth_user_id) {
      const { data: { user } } = await supabase.auth.getUser(accessToken)
      isHost = user?.id === room.scheduler_auth_user_id
    }

    if (isHost) {
      await supabase.from('room_participants').insert({
        room_id: room.id,
        display_name: displayName,
        is_active: true,
        joined_at: new Date().toISOString(),
        role: 'host',
      })
      // Falls through to normal token issuance below.
    } else {
      // Upsert this identity's admission request — idempotent across
      // repeat calls (initial request, retries, reconnects) thanks to the
      // (room_id, identity) unique constraint.
      const { data: existing } = await supabase
        .from('admission_requests')
        .select('id, status')
        .eq('room_id', room.id)
        .eq('identity', participantIdentity)
        .maybeSingle()

      if (!existing) {
        const { data: created, error: reqError } = await supabase
          .from('admission_requests')
          .insert({ room_id: room.id, identity: participantIdentity, display_name: displayName })
          .select('id, status')
          .single()
        if (reqError) {
          console.error('[token] admission_requests insert failed:', reqError.message)
          return res.status(500).json({ error: 'Failed to request admission' })
        }
        return res.status(202).json({ status: 'pending', requestId: created.id })
      }

      if (existing.status === 'denied') {
        return res.status(403).json({ error: 'The host did not admit you to this meeting', requestId: existing.id })
      }
      if (existing.status === 'pending') {
        return res.status(202).json({ status: 'pending', requestId: existing.id })
      }
      // status === 'admitted' — falls through to normal token issuance
      // below (covers reconnects after being let in).
    }
  }

  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: participantIdentity, name: displayName }
  )

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  })

  return res.json({ token: await token.toJwt() })
})

// ============================================================
// ROOM MODERATOR CHECK — shared by every moderation-only endpoint
// ============================================================
// Authorizes the caller either via a matching hostSecret, or by confirming
// their own room_participants row already has role 'host'/'co-host' — the
// only two ways to prove "I'm allowed to moderate this room". Originally
// lived inline in /admit only; extracted so /mute (below) enforces the exact
// same rule rather than a second, potentially-diverging copy of it.
async function isRoomModerator(roomId, hostSecret, actingDisplayName) {
  if (hostSecret) {
    const { data: hostRow } = await supabase.from('room_hosts').select('host_secret').eq('room_id', roomId).single()
    if (hostRow?.host_secret === hostSecret) return true
  }
  if (actingDisplayName) {
    // room_participants has no identity column — role is looked up by
    // display_name here, same limitation the participant_left webhook
    // already lives with elsewhere in this file (see its comment above).
    // Acceptable here because only an already-admitted host/co-host reaches
    // this branch at all, and a display_name collision can only ever widen
    // who's treated as a co-host within a room they're already inside, not
    // grant entry to anyone new or escalate beyond what a real host/co-host
    // could already do.
    const { data: rows } = await supabase
      .from('room_participants')
      .select('role')
      .eq('room_id', roomId)
      .eq('display_name', actingDisplayName)
      .eq('is_active', true)
    return (rows ?? []).some(r => r.role === 'host' || r.role === 'co-host')
  }
  return false
}

// ============================================================
// BEEHIVE BOT ASSISTANT — live, shared meeting agenda
// POST /api/rooms/:roomId/agenda
// Body: { title, organizerName, objectives, items, actingDisplayName, hostSecret? }
// ============================================================
// Reads happen straight from the client via Supabase (meeting_agendas has a
// permissive SELECT policy — see 006_meeting_agenda.sql) since anyone in the
// room needs to see the live agenda. Writes only ever go through here,
// authorized by the exact same isRoomModerator() check /admit and /mute
// already use — same "moderator" concept as every other in-meeting
// permission this app has, not a new one. Same edit-permission scope as
// mute/hand-lower: only meaningful in a waiting-room-gated (scheduled)
// meeting, where a host/co-host actually exists; an ungated Start Now
// meeting has no host concept at all, so nobody currently holds edit rights
// there either — consistent with how every other moderation feature in this
// app already behaves, not a new limitation introduced here.
//
// Single upsert-the-whole-blob write (not granular per-item endpoints) —
// this is a low-write-concurrency, single-editor-at-a-time surface, and the
// client already holds the full, current agenda state locally after any
// edit, so sending it whole keeps this endpoint (and the client's debounced
// auto-save) simple. Each item carries a stable client-generated id, so
// completed-state/notes/order all travel correctly across edits.
app.post('/api/rooms/:roomId/agenda', async (req, res) => {
  const { roomId } = req.params
  const { title, organizerName, objectives, items, actingDisplayName, hostSecret } = req.body
  if (typeof title !== 'string' || !Array.isArray(objectives) || !Array.isArray(items)) {
    return res.status(400).json({ error: 'title, objectives[], and items[] are required' })
  }

  if (!(await isRoomModerator(roomId, hostSecret, actingDisplayName))) {
    return res.status(403).json({ error: 'Not authorized to edit the agenda in this room' })
  }

  const { error } = await supabase.from('meeting_agendas').upsert({
    room_id: roomId,
    title,
    organizer_name: organizerName ?? null,
    objectives,
    items,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    console.error('[agenda] upsert failed:', error.message)
    return res.status(500).json({ error: 'Failed to save the agenda' })
  }

  return res.json({ ok: true })
})

// ============================================================
// ADMIT / DENY a waiting attendee
// POST /api/rooms/:roomId/admit
// Body: { requestId, decision: 'admit'|'deny', actingDisplayName, hostSecret? }
// ============================================================
app.post('/api/rooms/:roomId/admit', async (req, res) => {
  const { roomId } = req.params
  const { requestId, decision, actingDisplayName, hostSecret } = req.body
  if (!requestId || (decision !== 'admit' && decision !== 'deny')) {
    return res.status(400).json({ error: 'requestId and a valid decision are required' })
  }

  if (!(await isRoomModerator(roomId, hostSecret, actingDisplayName))) {
    return res.status(403).json({ error: 'Not authorized to admit participants in this room' })
  }

  const status = decision === 'admit' ? 'admitted' : 'denied'
  const { data: updated, error: updateError } = await supabase
    .from('admission_requests')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('room_id', roomId)
    .select()
    .single()

  if (updateError || !updated) {
    console.error('[admit] update failed:', updateError?.message)
    return res.status(500).json({ error: 'Failed to record decision' })
  }

  if (decision === 'admit') {
    await supabase.from('room_participants').insert({
      room_id: roomId,
      display_name: updated.display_name,
      is_active: true,
      joined_at: new Date().toISOString(),
      role: 'participant',
    })
  }

  return res.json({ ok: true })
})

// ============================================================
// HOST/CO-HOST FORCE-MUTE
// POST /api/rooms/:roomId/mute
// Body: { targetIdentity?, all?: boolean, excludeIdentity?, actingDisplayName, hostSecret? }
// ============================================================
// Muting another participant's microphone can only happen through LiveKit's
// server-side Room Service API (`mutePublishedTrack`) — the browser client
// SDK deliberately has no method to affect a track it doesn't own, so this
// cannot be implemented client-side no matter how the UI gates it. Never a
// force-*unmute*: LiveKit has no server-side unmute primitive by design
// (matches real browsers' autoplay/mic-gesture restrictions — a remote peer
// re-enabling someone's mic without their own action would itself be a
// privacy problem), which is why the client side of this feature is a
// "request unmute" nudge instead — see RoomPage.tsx's moderation channel.
app.post('/api/rooms/:roomId/mute', async (req, res) => {
  const { roomId } = req.params
  const { targetIdentity, all, excludeIdentity, actingDisplayName, hostSecret } = req.body
  if (!all && !targetIdentity) {
    return res.status(400).json({ error: 'targetIdentity or all is required' })
  }

  if (!(await isRoomModerator(roomId, hostSecret, actingDisplayName))) {
    return res.status(403).json({ error: 'Not authorized to moderate microphones in this room' })
  }

  const { data: room } = await supabase.from('rooms').select('livekit_room_name').eq('id', roomId).single()
  if (!room) return res.status(404).json({ error: 'Room not found' })

  try {
    const participants = await roomService.listParticipants(room.livekit_room_name)
    const targets = all
      ? participants.filter(p => p.identity !== excludeIdentity)
      : participants.filter(p => p.identity === targetIdentity)

    let mutedCount = 0
    for (const p of targets) {
      const micTrack = p.tracks.find(t => t.source === TrackSource.MICROPHONE)
      if (!micTrack || micTrack.muted) continue
      await roomService.mutePublishedTrack(room.livekit_room_name, p.identity, micTrack.sid, true)
      mutedCount++
    }
    return res.json({ ok: true, mutedCount })
  } catch (e) {
    console.error('[mute] failed:', e.message)
    return res.status(500).json({ error: 'Failed to mute participant(s)' })
  }
})

// ============================================================
// GRANT / REVOKE CO-HOST (delegated admit rights)
// POST /api/rooms/:roomId/grant-co-host
// Body: { displayName, grant: boolean, hostSecret }
// ============================================================
// Requires hostSecret specifically, not just a role check — delegation
// itself stays host-only ("by permission of the main attendee"), so a
// co-host can admit people but can never mint more co-hosts themselves.
app.post('/api/rooms/:roomId/grant-co-host', async (req, res) => {
  const { roomId } = req.params
  const { displayName, grant, hostSecret } = req.body
  if (!displayName || typeof grant !== 'boolean' || !hostSecret) {
    return res.status(400).json({ error: 'displayName, grant, and hostSecret are required' })
  }

  const { data: hostRow } = await supabase.from('room_hosts').select('host_secret').eq('room_id', roomId).single()
  if (hostRow?.host_secret !== hostSecret) {
    return res.status(403).json({ error: 'Not authorized to grant co-host in this room' })
  }

  const { error: updateError } = await supabase
    .from('room_participants')
    .update({ role: grant ? 'co-host' : 'participant' })
    .eq('room_id', roomId)
    .eq('display_name', displayName)
    .eq('is_active', true)

  if (updateError) {
    console.error('[grant-co-host] update failed:', updateError.message)
    return res.status(500).json({ error: 'Failed to update role' })
  }

  return res.json({ ok: true })
})

// ============================================================
// LIVE PARTICIPANT COUNT (for the invite-preview screen)
// GET /api/rooms/:roomId/participant-count
// ============================================================
// The invite-preview count (Lobby.tsx, before a guest has actually joined
// and connected to LiveKit) used to be a raw count of room_participants rows
// with is_active=true — a Supabase mirror kept in sync only by client-side
// leave events plus the participant_left/room_finished webhooks below. In
// production that mirror drifted: a real audit found dozens of rows still
// marked is_active=true hours (in some cases days) after the room had
// genuinely emptied, because a webhook not firing (or firing outside a
// window this code can control) leaves nothing to ever flip the flag back.
// Every other participant count in this app already reads live LiveKit data
// (RoomPage.tsx's header badge/dock/alone-timer all use useParticipants(),
// with an existing comment there noting the exact same is_active-can-lag
// problem) — this endpoint brings the one remaining DB-mirror-based count in
// line with that, by asking LiveKit's own Room Service for the room's actual
// current participants instead of trusting a local copy.
app.get('/api/rooms/:roomId/participant-count', async (req, res) => {
  const { roomId } = req.params
  const { data: room } = await supabase.from('rooms').select('livekit_room_name').eq('id', roomId).single()
  if (!room) return res.status(404).json({ error: 'Room not found' })

  try {
    const participants = await roomService.listParticipants(room.livekit_room_name)
    return res.json({ count: participants.length })
  } catch (e) {
    // listParticipants throws if the LiveKit room doesn't currently exist
    // server-side (e.g. it was never started, or has already closed) — that
    // means zero people are in it right now, not an error worth surfacing.
    return res.json({ count: 0 })
  }
})

// ============================================================
// LIVEKIT WEBHOOK — recording completed
// POST /api/livekit/webhook
// ============================================================
app.post('/api/livekit/webhook', async (req, res) => {
  // Verified WebhookEvent — see webhookReceiver's instantiation comment
  // above for why this was added. event.event/.room/.participant/
  // .egressInfo below are the exact same fields every branch already
  // destructured from the previously-unverified req.body; only the trust
  // level of the source changed, not the shape.
  let event
  try {
    event = await webhookReceiver.receive(req.rawBody.toString('utf8'), req.headers.authorization)
  } catch (e) {
    console.error('[webhook] signature verification failed:', e?.message)
    return res.status(401).json({ error: 'Invalid webhook signature' })
  }

  // ------------------------------------------------------------
  // Meeting Intelligence — start recording when the room actually goes
  // live, IF this room has recording_enabled (opt-in, off by default — see
  // 009_meeting_intelligence.sql). This is the automatic-lifecycle start;
  // the stop happens inside the existing room_finished branch below, and
  // the resulting file is picked up by the new, separate egress_ended
  // branch further down (NOT the pre-existing one, which stays untouched).
  // Any failure here is caught and logged only — it must never delay or
  // fail this webhook's response, since LiveKit and the room's own
  // lifecycle do not depend on this feature at all.
  // ------------------------------------------------------------
  if (event.event === 'room_started') {
    try {
      const { data: roomRow } = await supabase.from('rooms').select('id').eq('livekit_room_name', event.room?.name).single()
      if (roomRow) {
        const { data: settings } = await supabase.from('room_intelligence_settings').select('recording_enabled').eq('room_id', roomRow.id).single()
        if (settings?.recording_enabled) {
          // Idempotency guard: LiveKit's webhook delivery is at-least-once
          // (it retries), so room_started can genuinely arrive more than
          // once for the same room going live. Without this check, each
          // delivery would insert its own job row and start its own real,
          // billable LiveKit Egress recording — two simultaneous egresses
          // for one meeting, and room_finished's stop-egress lookup below
          // only expects one active job per room. One meeting must produce
          // exactly one recording; a second delivery while one is already
          // active is a no-op, not a second job.
          const { data: existing } = await supabase.from('meeting_intelligence_jobs')
            .select('id')
            .eq('room_id', roomRow.id)
            .eq('status', 'recording')
            .maybeSingle()
          if (existing) {
            console.log('[intelligence] room_started received again while a job is already recording — skipping duplicate egress:', roomRow.id)
          } else {
            const { data: job, error: insertError } = await supabase.from('meeting_intelligence_jobs')
              .insert({ room_id: roomRow.id, status: 'recording' })
              .select('id')
              .single()
            if (insertError || !job) {
              console.error('[intelligence] failed to create job row for opted-in room:', roomRow.id, insertError?.message)
            } else {
              // Own try/catch, distinct from the outer one: if the egress
              // call itself fails (LiveKit rejects the request, network
              // error, etc.), the job row already exists at this point —
              // without this, the failure would only be console-logged by
              // the outer catch below, leaving the job permanently stuck at
              // 'recording' forever. 'recording' is deliberately excluded
              // from the sweep's retry set (a long meeting legitimately
              // sits there for a while), so a job that never actually got a
              // real egress would otherwise never transition anywhere —
              // not retried, not marked failed, just a silent zombie the
              // Meeting Notes UI would show as "Recording…" indefinitely.
              try {
                const { egressId, storagePath } = await meetingIntelligence.startMeetingEgress(roomRow.id, event.room.name, job.id)
                const { error: updateError } = await supabase.from('meeting_intelligence_jobs')
                  .update({ egress_id: egressId, audio_storage_path: storagePath })
                  .eq('id', job.id)
                if (updateError) console.error('[intelligence] failed to record egress_id on job:', job.id, updateError.message)
              } catch (egressError) {
                console.error('[intelligence] startMeetingEgress failed, marking job failed:', job.id, egressError?.message)
                const { error: failError } = await supabase.from('meeting_intelligence_jobs')
                  .update({ status: 'failed', attempts: 1, last_error: String(egressError?.message ?? egressError).slice(0, 2000), updated_at: new Date().toISOString() })
                  .eq('id', job.id)
                if (failError) console.error('[intelligence] additionally failed to record the failure itself:', job.id, failError.message)
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[intelligence] failed to start egress:', e?.message)
    }
  }

  if (event.event === 'egress_ended') {
    const { egress_id, room_name, file } = event.egressInfo ?? {}

    // Find room in Supabase by livekit_room_name
    const { data: room } = await supabase
      .from('rooms')
      .select('id')
      .eq('livekit_room_name', room_name)
      .single()

    if (room && file) {
      await supabase.from('recordings').insert({
        room_id: room.id,
        file_url: file.location,
        storage_path: file.filename,
        file_size_bytes: file.size,
        duration_seconds: file.duration,
        status: 'ready',
        completed_at: new Date().toISOString(),
      })
    }
  }

  if (event.event === 'participant_left') {
    const { room_name, participant } = event

    const { data: room } = await supabase
      .from('rooms')
      .select('id')
      .eq('livekit_room_name', room_name)
      .single()

    if (room) {
      // participant.identity is now a random per-connection UUID (see the
      // token endpoint above) — match on participant.name instead, which
      // still carries the actual display name.
      await supabase
        .from('room_participants')
        .update({ is_active: false, left_at: new Date().toISOString() })
        .eq('room_id', room.id)
        .eq('display_name', participant.name)
    }
  }

  // LiveKit fires this once it has determined the room is actually empty and
  // closed it server-side — the one signal that can't be skipped by a client
  // exiting ungracefully (crash, force-quit, killed test process, etc). Every
  // other place that ends a room (leaveWithNotification, the alone-timer) runs
  // client-side JS that simply never executes in those cases, which is how
  // rooms were accumulating with is_active still true long after everyone
  // had actually left. This is the server-side backstop for that gap.
  if (event.event === 'room_finished') {
    const { room } = event
    await supabase
      .from('rooms')
      .update({ ended_at: new Date().toISOString(), is_active: false })
      .eq('livekit_room_name', room?.name)
      .eq('is_active', true)

    // ------------------------------------------------------------
    // Meeting Intelligence — stop recording now that the room is actually
    // closed. Additive: runs after the existing update above, only for
    // rooms that have an active job from the room_started branch (i.e.
    // recording_enabled was on) — a silent no-op for every other room,
    // identical to today's behavior.
    // ------------------------------------------------------------
    try {
      const { data: roomRow } = await supabase.from('rooms').select('id').eq('livekit_room_name', room?.name).single()
      if (roomRow) {
        // .limit(1) rather than .maybeSingle() — .maybeSingle() throws if
        // more than one row matches, and this stop path must never let a
        // lookup-shape surprise (e.g. a stray leftover row) prevent an
        // active egress from being stopped and left running indefinitely.
        const { data: jobs } = await supabase.from('meeting_intelligence_jobs')
          .select('id, egress_id')
          .eq('room_id', roomRow.id)
          .eq('status', 'recording')
          .order('created_at', { ascending: false })
          .limit(1)
        const job = jobs?.[0]
        if (job?.egress_id) await egressClient.stopEgress(job.egress_id)
      }
    } catch (e) {
      console.error('[intelligence] stopEgress failed:', e?.message)
    }
  }

  // ------------------------------------------------------------
  // Meeting Intelligence — a FOURTH, independent egress_ended branch (not a
  // modification of the pre-existing one above, which stays untouched and
  // keeps feeding the `recordings` table/useRecordings() UI exactly as
  // before). Only matches egresses this feature itself started (by
  // egress_id, set at room_started) — for every other egress (the
  // pre-existing manual/screen-share recording flow), no matching job row
  // exists and this branch is a silent no-op.
  //
  // Note: event.egressInfo here uses the verified WebhookEvent's real field
  // names (egressId, not egress_id) — see the egress_id/room_name comment
  // on the pre-existing branch above, which reads the wrong casing for that
  // (unrelated, pre-existing) field.
  //
  // CRITICAL, confirmed via a live debug trace of a real parsed WebhookEvent:
  // EgressInfo has NO usable singular `file` field — `file = 8` is marked
  // `[deprecated = true]` in the current @livekit/protocol schema and comes
  // back completely absent from a real parsed payload (confirmed directly:
  // Object.keys(event.egressInfo) on a genuine parse never includes `file`
  // at all). The real, current field is `fileResults` — a repeated
  // FileInfo array (one entry per output; a RoomCompositeEgressRequest with
  // a single EncodedFileOutput, which is all startMeetingEgress ever
  // configures, produces exactly one). Reading `file` here — as originally
  // written — meant this entire branch silently no-op'd on every real
  // egress_ended delivery, forever: `if (job && file)` was always false, so
  // nothing downstream of a real recording finishing would ever have
  // fired, no matter how correctly everything else in the pipeline was
  // built. This is the single highest-impact fix in this audit.
  // ------------------------------------------------------------
  if (event.event === 'egress_ended') {
    const { egressId, fileResults } = event.egressInfo ?? {}
    const file = fileResults?.[0]
    try {
      const { data: job } = await supabase.from('meeting_intelligence_jobs').select('id').eq('egress_id', egressId).maybeSingle()
      if (job && file) {
        const { data: updated, error: updateError } = await supabase.from('meeting_intelligence_jobs')
          // audio_storage_path was already set deterministically at
          // room_started (see meetingIntelligence.js) — file.location here
          // (correctly cased, unlike the pre-existing branch's fields) is
          // stored only for observability/debugging, not read by runJob().
          .update({ status: 'egress_done', audio_url: file.location, updated_at: new Date().toISOString() })
          .eq('id', job.id)
          .select()
          .single()
        if (updateError || !updated) {
          console.error('[intelligence] failed to mark job egress_done, job will never be dispatched for processing:', job.id, updateError?.message)
        } else {
          setImmediate(() => meetingIntelligence.runJob(updated.id).catch(e => console.error('[intelligence] job failed:', updated.id, e?.message)))
        }
      }
    } catch (e) {
      console.error('[intelligence] egress_ended handling failed:', e?.message)
    }
  }

  res.status(200).json({ received: true })
})

// ============================================================
// FATHOM — meeting intelligence proxy
// GET  /api/fathom/meetings
// GET  /api/fathom/recordings/:id/transcript
// ============================================================
const FATHOM_BASE = 'https://api.fathom.ai/external/v1'

app.get('/api/fathom/meetings', async (req, res) => {
  const key = process.env.FATHOM_API_KEY
  if (!key) return res.status(503).json({ error: 'FATHOM_API_KEY not configured' })

  const params = new URLSearchParams({
    include_summary: 'true',
    include_action_items: 'true',
    limit: String(req.query.limit ?? 10),
  })
  if (req.query.cursor) params.set('cursor', String(req.query.cursor))
  if (req.query.created_after) params.set('created_after', String(req.query.created_after))

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const resp = await fetch(`${FATHOM_BASE}/meetings?${params}`, {
      headers: { 'X-Api-Key': key, 'Accept': 'application/json', 'User-Agent': 'BeeHive/1.0' },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) {
      const body = await resp.text()
      console.error('[Fathom]', resp.status, body.slice(0, 200))
      return res.status(resp.status).json({ error: 'Fathom API error', status: resp.status })
    }
    res.json(await resp.json())
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Fathom API timed out' : 'Failed to reach Fathom API'
    console.error('[Fathom]', msg, e?.message)
    res.status(502).json({ error: msg })
  }
})

app.get('/api/fathom/recordings/:id/transcript', async (req, res) => {
  const key = process.env.FATHOM_API_KEY
  if (!key) return res.status(503).json({ error: 'FATHOM_API_KEY not configured' })

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const resp = await fetch(`${FATHOM_BASE}/recordings/${req.params.id}/transcript`, {
      headers: { 'X-Api-Key': key, 'Accept': 'application/json', 'User-Agent': 'BeeHive/1.0' },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!resp.ok) return res.status(resp.status).json({ error: 'Fathom API error' })
    res.json(await resp.json())
  } catch (e) {
    const msg = e?.name === 'AbortError' ? 'Fathom API timed out' : 'Failed to reach Fathom API'
    res.status(502).json({ error: msg })
  }
})

// ============================================================
// MEETING INVITATIONS — create
// POST /api/rooms/:roomId/invitations
// Body: { emails: string[], inviterName: string, hostSecret: string }
// ============================================================
// Requires hostSecret so only the actual room creator can send invitations.
// Upserts on (room_id, invitee_email) — safe to call multiple times (e.g.
// when the host edits the email list and re-sends).
app.post('/api/rooms/:roomId/invitations', async (req, res) => {
  const { roomId } = req.params
  const { emails, inviterName, hostSecret } = req.body
  if (!Array.isArray(emails) || emails.length === 0 || !inviterName) {
    return res.status(400).json({ error: 'emails[] and inviterName are required' })
  }

  const { data: hostRow } = await supabase.from('room_hosts').select('host_secret').eq('room_id', roomId).single()
  if (!hostRow || hostRow.host_secret !== hostSecret) {
    return res.status(403).json({ error: 'Not authorized to invite to this room' })
  }

  const rows = emails.map(email => ({
    room_id: roomId,
    invitee_email: email.toLowerCase().trim(),
    invited_by_name: inviterName,
    status: 'pending',
  }))

  const { error } = await supabase
    .from('meeting_invitations')
    .upsert(rows, { onConflict: 'room_id,invitee_email', ignoreDuplicates: false })

  if (error) {
    console.error('[invitations] upsert failed:', error.message)
    return res.status(500).json({ error: 'Failed to create invitations' })
  }

  return res.json({ ok: true, count: rows.length })
})

// ============================================================
// MEETING INVITATIONS — accept / decline / tentative
// PATCH /api/invitations/:id
// Body: { status: 'accepted'|'declined'|'tentative', accessToken: string }
// ============================================================
// Validates the caller's email matches the invitation's invitee_email so
// nobody can RSVP on someone else's behalf.
app.patch('/api/invitations/:id', async (req, res) => {
  const { id } = req.params
  const { status, accessToken } = req.body
  if (!['accepted', 'declined', 'tentative'].includes(status)) {
    return res.status(400).json({ error: 'status must be accepted, declined, or tentative' })
  }
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' })

  const { data: { user } } = await supabase.auth.getUser(accessToken)
  if (!user?.email) return res.status(401).json({ error: 'Invalid or expired token' })

  const { data: inv } = await supabase
    .from('meeting_invitations')
    .select('id, invitee_email')
    .eq('id', id)
    .single()

  if (!inv) return res.status(404).json({ error: 'Invitation not found' })
  if (inv.invitee_email !== user.email.toLowerCase()) {
    return res.status(403).json({ error: 'Not your invitation' })
  }

  const { error } = await supabase
    .from('meeting_invitations')
    .update({ status, responded_at: new Date().toISOString(), invitee_user_id: user.id })
    .eq('id', id)

  if (error) {
    console.error('[invitations] patch failed:', error.message)
    return res.status(500).json({ error: 'Failed to update invitation' })
  }

  return res.json({ ok: true })
})

// ============================================================
// MY MEETINGS — list all rooms the caller organized or was invited to
// GET /api/me/meetings
// Headers: Authorization: Bearer <access_token>
// ============================================================
// Returns a unified list merging organizer-created rooms and received
// invitations, sorted soonest-first (nulls — unscheduled rooms — last).
// The carousel subscribes to Realtime changes on meeting_invitations on the
// client side and calls this endpoint to re-fetch on any change.
app.get('/api/me/meetings', async (req, res) => {
  const raw = req.headers.authorization || ''
  const accessToken = raw.startsWith('Bearer ') ? raw.slice(7) : raw

  if (!accessToken) return res.status(401).json({ error: 'Authentication required' })

  const { data: { user } } = await supabase.auth.getUser(accessToken)
  if (!user?.email) return res.status(401).json({ error: 'Invalid or expired token' })

  const [organizedRes, invitedRes] = await Promise.all([
    // Rooms this user scheduled (they are the organizer)
    supabase
      .from('rooms')
      .select('id, name, scheduled_date, scheduled_time, duration_minutes, ended_at')
      .eq('scheduler_auth_user_id', user.id)
      .eq('is_active', true),
    // Invitations this user received (matched by email)
    supabase
      .from('meeting_invitations')
      .select('id, room_id, status, invited_by_name, invited_at, rooms(id, name, scheduled_date, scheduled_time, duration_minutes, ended_at, is_active)')
      .eq('invitee_email', user.email.toLowerCase()),
  ])

  const meetingMap = new Map()

  for (const room of (organizedRes.data ?? [])) {
    meetingMap.set(room.id, {
      id: room.id,
      roomId: room.id,
      roomName: room.name,
      scheduledDate: room.scheduled_date ?? null,
      scheduledTime: room.scheduled_time ?? null,
      durationMinutes: room.duration_minutes ?? null,
      endedAt: room.ended_at ?? null,
      role: 'organizer',
      status: null,
      invitationId: null,
      organizerName: 'You',
    })
  }

  for (const inv of (invitedRes.data ?? [])) {
    const room = inv.rooms
    // Skip declined, ended, or already-in-map (org takes priority), or inactive rooms
    if (!room || !room.is_active || meetingMap.has(room.id)) continue
    if (inv.status === 'declined') continue
    meetingMap.set(room.id, {
      id: inv.id,
      roomId: room.id,
      roomName: room.name,
      scheduledDate: room.scheduled_date ?? null,
      scheduledTime: room.scheduled_time ?? null,
      durationMinutes: room.duration_minutes ?? null,
      endedAt: room.ended_at ?? null,
      role: 'invitee',
      status: inv.status,
      invitationId: inv.id,
      organizerName: inv.invited_by_name || 'Unknown',
    })
  }

  // Sort: meetings with a date first (soonest → latest), then undated rooms
  const meetings = Array.from(meetingMap.values()).sort((a, b) => {
    const da = a.scheduledDate ? `${a.scheduledDate}T${a.scheduledTime || '00:00'}` : null
    const db = b.scheduledDate ? `${b.scheduledDate}T${b.scheduledTime || '00:00'}` : null
    if (da && db) return da < db ? -1 : da > db ? 1 : 0
    if (da) return -1
    if (db) return 1
    return 0
  })

  return res.json({ meetings })
})

// ============================================================
// MEETING INTELLIGENCE — opt-in settings toggle
// POST /api/rooms/:roomId/intelligence-settings
// Body: { recordingEnabled, aiNotesEnabled, hostSecret?, actingDisplayName? }
// ============================================================
// Gated by the exact same isRoomModerator() every other moderation-only
// endpoint already uses — no parallel auth check invented for this feature.
// Upserts room_intelligence_settings; no row = feature entirely inactive
// for that room (the default for every room unless this is called).
app.post('/api/rooms/:roomId/intelligence-settings', async (req, res) => {
  const { roomId } = req.params
  const { recordingEnabled, aiNotesEnabled, hostSecret, actingDisplayName } = req.body

  if (!(await isRoomModerator(roomId, hostSecret, actingDisplayName))) {
    return res.status(403).json({ error: 'Not authorized to change recording settings for this room' })
  }

  const { error } = await supabase.from('room_intelligence_settings').upsert({
    room_id: roomId,
    recording_enabled: !!recordingEnabled,
    ai_notes_enabled: !!aiNotesEnabled,
    updated_at: new Date().toISOString(),
  })
  if (error) {
    console.error('[intelligence] settings upsert failed:', error.message)
    return res.status(500).json({ error: 'Failed to update recording settings' })
  }

  return res.json({ ok: true })
})

// ============================================================
// MEETING INTELLIGENCE — this user's meeting notes
// GET /api/me/meeting-notes
// Header: Authorization: Bearer <accessToken>
// ============================================================
// Identity resolution mirrors /api/me/meetings exactly: organizer access via
// scheduler_auth_user_id, invitee access via meeting_invitations.invitee_email
// (lowercased). Reads meeting_intelligence_jobs/meeting_intelligence directly
// via the service-role client — these tables have zero client RLS policies
// (see 009_meeting_intelligence.sql), so this backend endpoint is the only
// way any of this data is ever reachable, by design.
app.get('/api/me/meeting-notes', async (req, res) => {
  const raw = req.headers.authorization || ''
  const accessToken = raw.startsWith('Bearer ') ? raw.slice(7) : raw
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' })

  const { data: { user } } = await supabase.auth.getUser(accessToken)
  if (!user?.email) return res.status(401).json({ error: 'Invalid or expired token' })

  const [organizedRes, invitedRes] = await Promise.all([
    supabase.from('rooms').select('id, name').eq('scheduler_auth_user_id', user.id),
    supabase.from('meeting_invitations').select('room_id, rooms(id, name)').eq('invitee_email', user.email.toLowerCase()).eq('status', 'accepted'),
  ])

  const roomMap = new Map()
  for (const room of (organizedRes.data ?? [])) roomMap.set(room.id, room.name)
  for (const inv of (invitedRes.data ?? [])) {
    if (inv.rooms && !roomMap.has(inv.rooms.id)) roomMap.set(inv.rooms.id, inv.rooms.name)
  }

  if (roomMap.size === 0) return res.json({ notes: [] })

  const roomIds = Array.from(roomMap.keys())
  const [jobsRes, intelligenceRes] = await Promise.all([
    supabase.from('meeting_intelligence_jobs').select('room_id, status, created_at').in('room_id', roomIds),
    supabase.from('meeting_intelligence').select('room_id, summary_markdown, action_items, created_at').in('room_id', roomIds),
  ])

  // A room can only ever have one active pipeline run in this design — take
  // the most recently created job/intelligence row per room if duplicates
  // somehow exist (e.g. a room recorded twice on different dates).
  const latestJobByRoom = new Map()
  for (const job of (jobsRes.data ?? [])) {
    const existing = latestJobByRoom.get(job.room_id)
    if (!existing || job.created_at > existing.created_at) latestJobByRoom.set(job.room_id, job)
  }
  const latestIntelligenceByRoom = new Map()
  for (const row of (intelligenceRes.data ?? [])) {
    const existing = latestIntelligenceByRoom.get(row.room_id)
    if (!existing || row.created_at > existing.created_at) latestIntelligenceByRoom.set(row.room_id, row)
  }

  const notes = roomIds
    .map(roomId => {
      const job = latestJobByRoom.get(roomId)
      const intelligence = latestIntelligenceByRoom.get(roomId)
      if (!job) return null // feature was never enabled for this room — omit entirely, not a "not_started" row
      return {
        roomId,
        roomName: roomMap.get(roomId),
        status: job.status,
        summaryMarkdown: intelligence?.summary_markdown ?? null,
        actionItems: intelligence?.action_items ?? null,
        createdAt: job.created_at,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // most recent first

  return res.json({ notes })
})

// ============================================================
// MEETING INTELLIGENCE — manual retry of a permanently failed job
// POST /api/rooms/:roomId/meeting-notes/retry
// Header: Authorization: Bearer <accessToken>
// ============================================================
// Once a job's attempts reach MAX_ATTEMPTS, meetingIntelligence.js's own
// sweep query (`.lt('attempts', MAX_ATTEMPTS)`) permanently excludes it —
// by design, so a permanently-broken job (bad credentials, a provider
// outage that outlasted every bounded retry) doesn't retry forever. That
// also means a genuinely 'failed' job has no path back without this:
// resets attempts/last_error and reverts to whichever stage's output is
// missing, then dispatches immediately rather than waiting for the sweep.
// Restricted to the room's organizer specifically (not any accepted
// invitee, unlike the read-only /api/me/meeting-notes) — retrying
// triggers real, billable transcription/LLM calls, so only the person who
// opted the room into recording can re-trigger spend on it.
app.post('/api/rooms/:roomId/meeting-notes/retry', async (req, res) => {
  const { roomId } = req.params
  const raw = req.headers.authorization || ''
  const accessToken = raw.startsWith('Bearer ') ? raw.slice(7) : raw
  if (!accessToken) return res.status(401).json({ error: 'Authentication required' })

  const { data: { user } } = await supabase.auth.getUser(accessToken)
  if (!user?.id) return res.status(401).json({ error: 'Invalid or expired token' })

  const { data: room } = await supabase.from('rooms').select('id, scheduler_auth_user_id').eq('id', roomId).single()
  if (!room || room.scheduler_auth_user_id !== user.id) {
    return res.status(403).json({ error: 'Only the meeting organizer can retry processing' })
  }

  const { data: jobs } = await supabase.from('meeting_intelligence_jobs')
    .select('*')
    .eq('room_id', roomId)
    .eq('status', 'failed')
    .order('created_at', { ascending: false })
    .limit(1)
  const job = jobs?.[0]
  if (!job) return res.status(404).json({ error: 'No failed job to retry for this room' })

  // A job can fail before any audio ever existed at all (e.g. the initial
  // LiveKit Egress request itself was rejected) — audio_storage_path is
  // only ever set once startMeetingEgress genuinely succeeds. Reverting
  // such a job to 'egress_done' would just fail downloadAudio() again on
  // every retry, forever, since there's nothing to download; this is a
  // fundamentally different, non-retryable failure (no recording exists),
  // not a transient processing hiccup, so say so instead of looping.
  if (!job.audio_storage_path) {
    return res.status(422).json({ error: 'This meeting was never successfully recorded — there is no audio to reprocess' })
  }

  // transcript_id already set means transcription succeeded before the
  // failure — resume at the summary stage; otherwise resume transcription.
  const resumeStatus = job.transcript_id ? 'transcribed' : 'egress_done'
  const { data: reset, error: resetError } = await supabase.from('meeting_intelligence_jobs')
    .update({ status: resumeStatus, attempts: 0, last_error: null, updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'failed') // still-atomic guard against a race with the sweep/another retry click
    .select()
    .maybeSingle()
  if (resetError || !reset) {
    return res.status(409).json({ error: 'Job is no longer in a failed state — it may already be retrying' })
  }

  setImmediate(() => meetingIntelligence.runJob(reset.id).catch(e => console.error('[intelligence] manual retry failed:', reset.id, e?.message)))
  return res.json({ ok: true, status: resumeStatus })
})

// ============================================================
// DELETE SCHEDULED MEETING
// DELETE /api/rooms/:roomId
// Body: { hostSecret: string }
// ============================================================
// Organizer-only. Deletes the room row (cascade removes invitations via FK).
app.delete('/api/rooms/:roomId', async (req, res) => {
  const { roomId } = req.params
  const { hostSecret } = req.body

  if (!hostSecret) return res.status(400).json({ error: 'hostSecret required' })

  const { data: hostRow } = await supabase.from('room_hosts').select('host_secret').eq('room_id', roomId).single()
  if (!hostRow || hostRow.host_secret !== hostSecret) {
    return res.status(403).json({ error: 'Not authorized to delete this room' })
  }

  const { error } = await supabase.from('rooms').delete().eq('id', roomId)
  if (error) {
    console.error('[rooms] delete failed:', error.message)
    return res.status(500).json({ error: 'Failed to delete room' })
  }

  return res.json({ ok: true })
})

// ============================================================
// AUTO-UPDATE FEED
// Serves YAML manifests consumed by electron-updater (generic provider)
// and a metadata endpoint with critical/notes/minimumVersion details.
//
// Configuration:
//   update-config.json  — generated by scripts/publish-update.mjs after each
//                         desktop build; updated manually or via CI.
//
// Endpoints:
//   GET /updates/latest-mac.yml  — macOS update manifest
//   GET /updates/latest.yml      — Windows update manifest
//   GET /updates/metadata        — extended metadata (critical, notes, etc.)
// ============================================================

function loadUpdateConfig() {
  try {
    const p = join(__dirname, 'update-config.json')
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch { return null }
}

app.get('/updates/latest-mac.yml', (_, res) => {
  const cfg = loadUpdateConfig()
  if (!cfg?.version || !cfg?.mac) {
    return res.status(404).send('# No update config found')
  }
  const m = cfg.mac
  const yml = [
    `version: ${cfg.version}`,
    'files:',
    `  - url: ${m.url}`,
    `    sha512: ${m.sha512}`,
    `    size: ${m.size}`,
    ...(m.dmgUrl ? [
      `  - url: ${m.dmgUrl}`,
      `    sha512: ${m.dmgSha512}`,
      `    size: ${m.dmgSize}`,
    ] : []),
    `path: ${m.url.split('/').pop()}`,
    `sha512: ${m.sha512}`,
    `releaseDate: '${cfg.releaseDate || new Date().toISOString()}'`,
  ].join('\n')
  res.set('Content-Type', 'text/yaml; charset=utf-8')
  res.set('Cache-Control', 'no-cache')
  res.send(yml)
})

app.get('/updates/latest.yml', (_, res) => {
  const cfg = loadUpdateConfig()
  if (!cfg?.version || !cfg?.win) {
    return res.status(404).send('# No update config found')
  }
  const w = cfg.win
  const yml = [
    `version: ${cfg.version}`,
    'files:',
    `  - url: ${w.url}`,
    `    sha512: ${w.sha512}`,
    `    size: ${w.size}`,
    ...(w.x64Url ? [
      `  - url: ${w.x64Url}`,
      `    sha512: ${w.x64Sha512}`,
      `    size: ${w.x64Size}`,
    ] : []),
    ...(w.arm64Url ? [
      `  - url: ${w.arm64Url}`,
      `    sha512: ${w.arm64Sha512}`,
      `    size: ${w.arm64Size}`,
    ] : []),
    `path: ${w.url.split('/').pop()}`,
    `sha512: ${w.sha512}`,
    `releaseDate: '${cfg.releaseDate || new Date().toISOString()}'`,
  ].join('\n')
  res.set('Content-Type', 'text/yaml; charset=utf-8')
  res.set('Cache-Control', 'no-cache')
  res.send(yml)
})

app.get('/updates/metadata', (_, res) => {
  const cfg = loadUpdateConfig()
  if (!cfg) return res.json({ critical: false, notes: [], minimumVersion: null })
  res.set('Cache-Control', 'no-cache')
  res.json({
    version: cfg.version,
    critical: cfg.critical ?? false,
    notes: cfg.notes ?? [],
    minimumVersion: cfg.minimumVersion ?? null,
    releaseDate: cfg.releaseDate ?? null,
  })
})

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (_, res) => res.json({ status: 'ok' }))

// ============================================================
// SERVE FRONTEND (production — Render single-service deploy)
// ============================================================
const distPath = join(__dirname, 'dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('/*splat', (_, res) => res.sendFile(join(distPath, 'index.html')))
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`BeeHive backend running on port ${PORT}`)
  // Retries any Meeting Intelligence job stuck in a post-egress stage — see
  // meetingIntelligence.js's SWEEPABLE_STATUSES for exactly which statuses
  // this can touch. The first interval-based job in this file; started here
  // (server boot) rather than at import time so it can't fire before the
  // server is actually accepting the requests its own retries depend on.
  meetingIntelligence.startIntelligenceSweep()
})
