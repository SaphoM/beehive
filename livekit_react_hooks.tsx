import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
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
  const [room, setRoom] = useState<{ name: string; participantCount: number; ended_at: string | null } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    Promise.all([
      supabase.from('rooms').select('name, ended_at').eq('id', roomId).single(),
      supabase.from('room_participants').select('id', { count: 'exact' }).eq('room_id', roomId).eq('is_active', true),
    ]).then(([roomRes, participantsRes]) => {
      if (roomRes.data) {
        setRoom({ name: roomRes.data.name, participantCount: participantsRes.count ?? 0, ended_at: roomRes.data.ended_at ?? null })
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

    // Clear any stale active records for this name in this room before inserting fresh one
    const { data: { user } } = await supabase.auth.getUser()
    await supabase.from('room_participants')
      .update({ is_active: false })
      .eq('room_id', roomId)
      .eq('display_name', displayName)

    // Insert a fresh active row — always insert so joined_at is current
    await supabase.from('room_participants').insert({
      room_id: roomId,
      user_id: user?.id ?? null,
      display_name: displayName,
      is_active: true,
      joined_at: new Date().toISOString(),
    })

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
// FATHOM — meeting intelligence
// ============================================================
export interface FathomAttendee {
  name: string
  email: string
  is_external: boolean
}

export interface FathomActionItem {
  description: string
  completed: boolean
  user_generated: boolean
  recording_timestamp?: string
  recording_playback_url?: string
  assignee?: { name: string; email: string }
}

export interface FathomTranscriptLine {
  speaker: { display_name: string; matched_calendar_invitee_email?: string }
  text: string
  timestamp: string
}

export interface FathomMeeting {
  title: string
  meeting_title?: string
  url: string
  share_url?: string
  created_at: string
  recording_start_time?: string
  recording_end_time?: string
  transcript_language?: string
  calendar_invitees?: FathomAttendee[]
  recorded_by?: { name: string; email: string; team?: string }
  default_summary?: { template_name: string; markdown_formatted: string }
  action_items?: FathomActionItem[]
}

export function useFathomMeetings(limit = 8) {
  const [meetings, setMeetings] = useState<FathomMeeting[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)

  const fetchPage = useCallback(async (cursor?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (cursor) params.set('cursor', cursor)
      const resp = await fetch(`/api/fathom/meetings?${params}`)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      if (data.error) throw new Error(data.error)
      setMeetings(prev => cursor ? [...prev, ...(data.items ?? [])] : (data.items ?? []))
      setNextCursor(data.next_cursor ?? null)
      setError(null)
    } catch (e: any) {
      setError(e.message ?? 'Could not load Fathom meetings')
    } finally {
      setLoading(false)
    }
  }, [limit])

  useEffect(() => { fetchPage() }, [fetchPage])

  return { meetings, loading, error, hasMore: !!nextCursor, loadMore: () => fetchPage(nextCursor ?? undefined) }
}

export function useFathomTranscript(recordingId: string | null) {
  const [transcript, setTranscript] = useState<FathomTranscriptLine[] | null>(null)
  const [loading, setLoading] = useState(false)

  const loadTranscript = useCallback(async () => {
    if (!recordingId) return
    setLoading(true)
    try {
      const resp = await fetch(`/api/fathom/recordings/${recordingId}/transcript`)
      if (resp.ok) {
        const data = await resp.json()
        setTranscript(Array.isArray(data) ? data : (data.transcript ?? null))
      }
    } catch {}
    setLoading(false)
  }, [recordingId])

  return { transcript, loading, loadTranscript }
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
