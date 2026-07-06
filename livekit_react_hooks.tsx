import { useEffect, useState, useCallback } from 'react'
import { createClient, Session, User } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      // Implicit flow puts self-contained tokens in the URL *hash*
      // (#access_token&refresh_token) rather than a PKCE ?code that must be
      // exchanged using a verifier stored in the *originating* app's storage.
      // The desktop magic-link handoff opens a different app instance than the
      // one that requested the link, so a PKCE code can't be exchanged there
      // and the user lands back on the sign-in screen. Implicit tokens can be
      // consumed by any instance via setSession — which is exactly what
      // AuthGate and DesktopHandoff already do.
      flowType: 'implicit',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  }
)

// In packaged Electron (file: origin) there is no Vite proxy — hit :3001 directly.
// In dev Electron the renderer is served by Vite (http: origin), so use the proxy.
const API_BASE = typeof window !== 'undefined' && (window as any).electronAPI && window.location.protocol === 'file:'
  ? 'http://localhost:3001'
  : ''

// ============================================================
// AUTH TYPES
// ============================================================

export interface Profile {
  id: string
  full_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

// ============================================================
// useAuth — session listener, magic link, OTP
// ============================================================
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      setLoading(false)
    })
    return () => subscription.unsubscribe()
  }, [])

  const signInWithMagicLink = useCallback(async (email: string) => {
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: isElectron
          ? 'beehive://auth/confirm'
          : `${window.location.origin}/?auth=confirm`,
        shouldCreateUser: true,
      },
    })
    return { error: error?.message ?? null }
  }, [])

  const signInWithOtp = useCallback(async (email: string) => {
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // The email carries both a 6-digit code and a magic link. Point that
        // link back to the desktop app (beehive://) when sent from Electron so
        // clicking it signs the user in *in the desktop app* instead of
        // bouncing to the web Site URL. On web, return to the web callback.
        emailRedirectTo: isElectron
          ? 'beehive://auth/confirm'
          : `${window.location.origin}/?auth=confirm`,
        shouldCreateUser: true,
      },
    })
    return { error: error?.message ?? null }
  }, [])

  const verifyOtp = useCallback(async (email: string, token: string) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    return { error: error?.message ?? null }
  }, [])

  const signOut = useCallback(async () => { await supabase.auth.signOut() }, [])

  return { session, user, loading, signInWithMagicLink, signInWithOtp, verifyOtp, signOut }
}

// ============================================================
// useProfile — read + update own profile
// ============================================================
export function useProfile(userId: string | null) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!userId) { setProfile(null); return }
    setLoading(true)
    supabase.from('profiles').select('*').eq('id', userId).single()
      .then(({ data }) => { setProfile(data ?? null); setLoading(false) })
  }, [userId])

  const updateProfile = useCallback(async (updates: Partial<Pick<Profile, 'full_name' | 'avatar_url'>>) => {
    if (!userId) return { error: 'Not authenticated' }
    const { error } = await supabase.from('profiles').update(updates).eq('id', userId)
    if (!error) setProfile(prev => prev ? { ...prev, ...updates } : null)
    return { error: error?.message ?? null }
  }, [userId])

  return { profile, loading, updateProfile }
}

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

    // Fetch room info and local session in parallel — no dependency between them
    const [{ data: room, error: roomError }, { data: { session } }] = await Promise.all([
      supabase.from('rooms').select('livekit_room_name, name').eq('id', roomId).single(),
      supabase.auth.getSession(), // local cache — no server roundtrip
    ])

    if (roomError || !room) {
      setError('Room not found')
      setLoading(false)
      return null
    }

    // Deactivate any stale active records for this display name in this room
    await supabase.from('room_participants')
      .update({ is_active: false })
      .eq('room_id', roomId)
      .eq('display_name', displayName)

    // A LiveKit identity must be unique per connection — two participants
    // (or two tabs sharing one logged-in profile's name) joining with the
    // same identity causes LiveKit to disconnect the earlier one, which
    // looked like "their mic doesn't work". Display names are freeform and
    // collide easily, so identity is a random UUID instead; displayName is
    // still sent separately and used as LiveKit's "name" field for display.
    const identity = crypto.randomUUID()

    // Insert fresh participant row and fetch LiveKit token in parallel —
    // the token only needs roomName + displayName, not the participant row ID
    const [, tokenRes] = await Promise.all([
      supabase.from('room_participants').insert({
        room_id: roomId,
        user_id: session?.user?.id ?? null,
        display_name: displayName,
        is_active: true,
        joined_at: new Date().toISOString(),
      }),
      fetch(`${API_BASE}/api/livekit/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: room.livekit_room_name, displayName, identity }),
      }),
    ])

    if (!tokenRes.ok) {
      setError('Failed to get access token')
      setLoading(false)
      return null
    }

    const { token } = await tokenRes.json()
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
    // getSession() reads from local storage — no server roundtrip needed for a chat insert
    const { data: { session } } = await supabase.auth.getSession()

    await supabase.from('chat_messages').insert({
      room_id: roomId,
      user_id: session?.user?.id,
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
      const resp = await fetch(`${API_BASE}/api/fathom/meetings?${params}`)
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
      const resp = await fetch(`${API_BASE}/api/fathom/recordings/${recordingId}/transcript`)
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
