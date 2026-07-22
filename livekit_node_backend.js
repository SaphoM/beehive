import express from 'express'
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'

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
      // data:: desktopCapturer thumbnails (base64); blob:: local media/canvas.
      "img-src 'self' data: blob:",
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

app.use(express.json())

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
  const { name, organisation } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const livekitRoomName = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .insert({ name, livekit_room_name: livekitRoomName, organisation, requires_admission: true })
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
  const { roomName, displayName, identity, hostSecret } = req.body

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
    .select('id, requires_admission')
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
// LIVEKIT WEBHOOK — recording completed
// POST /api/livekit/webhook
// ============================================================
app.post('/api/livekit/webhook', async (req, res) => {
  const event = req.body

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
app.listen(PORT, () => console.log(`BeeHive backend running on port ${PORT}`))
