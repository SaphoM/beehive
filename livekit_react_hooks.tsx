import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)

// ============================================================
// TYPES
// ============================================================
interface Room {
  id: string
  name: string
  livekit_room_name: string
  created_by: string
  is_active: boolean
  created_at: string
}

interface Participant {
  id: string
  room_id: string
  user_id: string
  display_name: string
  joined_at: string
  is_active: boolean
  role: 'host' | 'co-host' | 'participant'
}

interface ChatMessage {
  id: string
  room_id: string
  user_id: string
  display_name: string
  message: string
  created_at: string
}

// ============================================================
// ROOM CREATION
// ============================================================
export function useCreateRoom() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createRoom = useCallback(async (name: string, organisation?: string) => {
    setLoading(true)
    setError(null)

    const livekitRoomName = `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    const { data, error } = await supabase
      .from('rooms')
      .insert({ name, livekit_room_name: livekitRoomName, organisation })
      .select()
      .single()

    setLoading(false)

    if (error) {
      setError(error.message)
      return null
    }

    return data as Room
  }, [])

  return { createRoom, loading, error }
}

// ============================================================
// ROOM INFO (for invite preview)
// ============================================================
export function useRoomInfo(roomId: string | null) {
  const [room, setRoom] = useState<{ name: string; participantCount: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    Promise.all([
      supabase.from('rooms').select('name').eq('id', roomId).single(),
      supabase.from('room_participants').select('id', { count: 'exact' }).eq('room_id', roomId).eq('is_active', true),
    ]).then(([roomRes, participantsRes]) => {
      if (roomRes.data) {
        setRoom({ name: roomRes.data.name, participantCount: participantsRes.count ?? 0 })
      }
      setLoading(false)
    })
  }, [roomId])

  return { room, loading }
}

// ============================================================
// LIVEKIT TOKEN
// ============================================================
export function useJoinRoom() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const joinRoom = useCallback(async (roomId: string, displayName: string) => {
    setLoading(true)
    setError(null)

    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('livekit_room_name, name')
      .eq('id', roomId)
      .single()

    if (roomError || !room) {
      setError('Room not found')
      setLoading(false)
      return null
    }

    // Track participant (anon-safe: user_id is optional)
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('room_participants').upsert({
      room_id: roomId,
      user_id: user?.id ?? null,
      display_name: displayName,
      is_active: true,
      joined_at: new Date().toISOString(),
    }, { onConflict: user?.id ? 'room_id,user_id' : undefined })

    const res = await fetch('/api/livekit/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomName: room.livekit_room_name, displayName }),
    })

    if (!res.ok) {
      setError('Failed to get access token')
      setLoading(false)
      return null
    }

    const { token } = await res.json()
    setLoading(false)
    return { token, livekitRoomName: room.livekit_room_name, roomName: room.name }
  }, [])

  return { joinRoom, loading, error }
}

// ============================================================
// PARTICIPANT LIST (real-time)
// ============================================================
export function useParticipants(roomId: string) {
  const [participants, setParticipants] = useState<Participant[]>([])

  useEffect(() => {
    if (!roomId) return

    // Initial fetch
    supabase
      .from('room_participants')
      .select('*')
      .eq('room_id', roomId)
      .eq('is_active', true)
      .then(({ data }) => setParticipants(data ?? []))

    // Real-time subscription
    const channel = supabase
      .channel(`participants:${roomId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_participants', filter: `room_id=eq.${roomId}` },
        () => {
          supabase
            .from('room_participants')
            .select('*')
            .eq('room_id', roomId)
            .eq('is_active', true)
            .then(({ data }) => setParticipants(data ?? []))
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  return participants
}

// ============================================================
// CHAT (real-time)
// ============================================================
export function useChat(roomId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!roomId) return

    // Initial fetch
    supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setMessages(data ?? []))

    // Real-time subscription
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => setMessages((prev) => [...prev, payload.new as ChatMessage])
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  const sendMessage = useCallback(async (message: string, displayName: string) => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()

    await supabase.from('chat_messages').insert({
      room_id: roomId,
      user_id: user?.id,
      display_name: displayName,
      message,
    })
    setLoading(false)
  }, [roomId])

  return { messages, sendMessage, loading }
}

// ============================================================
// RECORDINGS
// ============================================================
export function useRecordings(roomId: string) {
  const [recordings, setRecordings] = useState<any[]>([])

  useEffect(() => {
    if (!roomId) return

    supabase
      .from('recordings')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setRecordings(data ?? []))
  }, [roomId])

  return recordings
}
