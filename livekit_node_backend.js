import express from 'express'
import { AccessToken } from 'livekit-server-sdk'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

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
      headers: { 'X-Api-Key': key },
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
      headers: { 'X-Api-Key': key },
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

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`BeeHive backend running on port ${PORT}`))
