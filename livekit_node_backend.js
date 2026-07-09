import express from 'express'
import { AccessToken } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'

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

// ============================================================
// GENERATE LIVEKIT TOKEN
// POST /api/livekit/token
// Body: { roomName, displayName }
// ============================================================
app.post('/api/livekit/token', async (req, res) => {
  const { roomName, displayName, identity } = req.body

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
