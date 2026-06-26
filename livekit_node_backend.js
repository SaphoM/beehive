import express from 'express'
import { AccessToken } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { existsSync } from 'fs'
import { randomBytes } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))

dotenv.config()

const app = express()
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
  const { roomName, displayName } = req.body

  if (!roomName || !displayName) {
    return res.status(400).json({ error: 'roomName and displayName are required' })
  }

  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: displayName, name: displayName }
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
      await supabase
        .from('room_participants')
        .update({ is_active: false, left_at: new Date().toISOString() })
        .eq('room_id', room.id)
        .eq('display_name', participant.identity)
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
// INVITATIONS
// POST /api/invitations              — create (auth required via Bearer token)
// GET  /api/invitations/validate/:token — validate without redeeming
// POST /api/invitations/redeem/:token   — mark accepted (auth required)
// DELETE /api/invitations/:id           — revoke (auth required, own or admin)
// ============================================================

async function getAuthUser(req) {
  const header = req.headers['authorization'] ?? ''
  const jwt = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!jwt) return null
  const { data: { user }, error } = await supabase.auth.getUser(jwt)
  return error ? null : user
}

app.post('/api/invitations', async (req, res) => {
  const caller = await getAuthUser(req)
  if (!caller) return res.status(401).json({ error: 'Not authenticated' })

  const { invited_email, room_id } = req.body
  if (!invited_email) return res.status(400).json({ error: 'invited_email required' })

  const token = randomBytes(32).toString('hex')
  const { data, error } = await supabase.from('invitations').insert({
    token,
    invited_by: caller.id,
    invited_email,
    room_id: room_id ?? null,
  }).select().single()

  if (error) return res.status(500).json({ error: error.message })

  await supabase.from('audit_logs').insert({
    auth_user_id: caller.id,
    action: 'invitation_created',
    resource: 'invitations',
    resource_id: data.id,
    metadata: { invited_email, room_id },
  })

  res.json(data)
})

app.get('/api/invitations/validate/:token', async (req, res) => {
  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', req.params.token)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Invitation not found' })
  if (data.status === 'revoked')  return res.status(410).json({ error: 'Invitation revoked' })
  if (data.status === 'accepted') return res.status(410).json({ error: 'Invitation already used' })
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('invitations').update({ status: 'expired' }).eq('id', data.id)
    return res.status(410).json({ error: 'Invitation expired' })
  }

  res.json(data)
})

app.post('/api/invitations/redeem/:token', async (req, res) => {
  const caller = await getAuthUser(req)
  if (!caller) return res.status(401).json({ error: 'Not authenticated' })

  const { data, error } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', req.params.token)
    .single()

  if (error || !data) return res.status(404).json({ error: 'Invitation not found' })
  if (data.status !== 'pending')  return res.status(410).json({ error: `Invitation is ${data.status}` })
  if (new Date(data.expires_at) < new Date()) return res.status(410).json({ error: 'Invitation expired' })

  await supabase.from('invitations').update({ status: 'accepted', used_at: new Date().toISOString() }).eq('id', data.id)

  await supabase.from('audit_logs').insert({
    auth_user_id: caller.id,
    action: 'invitation_redeemed',
    resource: 'invitations',
    resource_id: data.id,
    metadata: { invited_email: data.invited_email },
  })

  res.json({ ok: true })
})

app.delete('/api/invitations/:id', async (req, res) => {
  const caller = await getAuthUser(req)
  if (!caller) return res.status(401).json({ error: 'Not authenticated' })

  const { data, error } = await supabase.from('invitations').select('invited_by').eq('id', req.params.id).single()
  if (error || !data) return res.status(404).json({ error: 'Not found' })

  const { data: isAdminResult } = await supabase.rpc('is_admin')
  if (data.invited_by !== caller.id && !isAdminResult) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  await supabase.from('invitations').update({
    status: 'revoked',
    revoked_at: new Date().toISOString(),
    revoked_by: caller.id,
  }).eq('id', req.params.id)

  await supabase.from('audit_logs').insert({
    auth_user_id: caller.id,
    action: 'invitation_revoked',
    resource: 'invitations',
    resource_id: req.params.id,
  })

  res.json({ ok: true })
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
