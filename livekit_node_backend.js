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
// HEALTH CHECK
// ============================================================
app.get('/health', (_, res) => res.json({ status: 'ok' }))

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`LiveKit backend running on port ${PORT}`))
