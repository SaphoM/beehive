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

  const refresh = useCallback(() => {
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

  useEffect(() => { refresh() }, [refresh])

  // Exposed so a join attempt that discovers the room ended *after* this
  // component mounted (see useJoinRoom's ENDED_MEETING check) can flip the
  // lobby straight to the "Meeting Ended" card instead of just an alert —
  // this snapshot is otherwise only ever fetched once, on mount.
  return { room, loading, refresh }
}

// ============================================================
// LIVEKIT TOKEN
// ============================================================
// Distinct sentinel so callers (RoomPage's handleJoin) can tell "this
// meeting ended" apart from other join failures and react accordingly
// (flip the lobby to the "Meeting Ended" card) rather than a generic alert.
export const ENDED_MEETING_ERROR = 'This meeting has ended'

export function useJoinRoom() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Returns the failure reason directly on the resolved value, rather than
  // relying solely on the `error` state above. `handleJoin` needs to branch
  // on *this specific call's* outcome the instant the promise resolves — but
  // by then, `error` as read from the hook's own closure in the caller is
  // whatever it was when that render happened, not what setError() below
  // just set (React doesn't re-render synchronously mid-await), so checking
  // the hook's `error` state right after awaiting this would silently see
  // the previous call's stale value. Returning the reason inline sidesteps
  // that race entirely.
  const joinRoom = useCallback(async (roomId: string, displayName: string) => {
    setLoading(true)
    setError(null)

    // Fetch room info and local session in parallel — no dependency between them.
    // ended_at/is_active are the authoritative, freshly-fetched check: the
    // lobby's "Join Meeting" button is only *hidden* based on a snapshot taken
    // whenever the invite page loaded (useRoomInfo), which goes stale if the
    // meeting ends while that tab sits open. Without re-checking here, a
    // click on an already-stale-but-still-visible button would insert a
    // participant row and fetch a token for a meeting that's already over —
    // this is the actual gate that prevents joining a dead meeting.
    const [{ data: room, error: roomError }, { data: { session } }] = await Promise.all([
      supabase.from('rooms').select('livekit_room_name, name, ended_at, is_active').eq('id', roomId).single(),
      supabase.auth.getSession(), // local cache — no server roundtrip
    ])

    if (roomError || !room) {
      setError('Room not found')
      setLoading(false)
      return { error: 'Room not found' }
    }

    if (room.ended_at || room.is_active === false) {
      setError(ENDED_MEETING_ERROR)
      setLoading(false)
      return { error: ENDED_MEETING_ERROR }
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
    // the token only needs roomName + displayName, not the participant row ID.
    // auth_user_id, NOT user_id: user_id FKs to the legacy public.users table,
    // but session.user.id is an auth.users id with no matching public.users
    // row — writing it there violated the FK, so a SIGNED-IN user's
    // participant row silently never got inserted (guests, with null, were
    // fine). Downstream, anything reading room_participants (file-share
    // recipient list, invite-preview count, participant_left bookkeeping)
    // simply never saw authenticated participants. auth_user_id is the
    // bridge column 001_auth_system.sql added for this, FK'd to auth.users.
    const [{ error: participantError }, tokenRes] = await Promise.all([
      supabase.from('room_participants').insert({
        room_id: roomId,
        auth_user_id: session?.user?.id ?? null,
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
    if (participantError) console.error('[join] participant insert failed:', participantError.message)

    if (!tokenRes.ok) {
      setError('Failed to get access token')
      setLoading(false)
      return { error: 'Failed to get access token' }
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

    // Initial fetch — merged into existing state by id rather than a blind
    // overwrite. React StrictMode (dev only) double-mounts this effect, so
    // two of these fetches can be in flight at once; a plain `setMessages(data)`
    // risks a slow/duplicate fetch resolving *after* a realtime insert has
    // already appended a message, wiping it back out of view (looks exactly
    // like "sent a message and it didn't stick"). Merging by id makes this
    // safe regardless of fetch/realtime ordering.
    supabase
      .from('chat_messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) { console.error('[chat] initial fetch failed:', error.message); return }
        setMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]))
          for (const m of data ?? []) byId.set(m.id, m)
          return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at))
        })
      })

    // Real-time subscription — supabase.channel(topic) already reuses an
    // existing channel for the same topic internally (RealtimeClient.channel()
    // checks getChannels() itself), so React StrictMode's dev-only double
    // mount/cleanup/mount doesn't create duplicate channels here. The
    // subscribe callback below logs errors that were previously silent: a
    // channel that never reaches SUBSCRIBED (e.g. CHANNEL_ERROR/TIMED_OUT)
    // would mean inserts succeed (confirmed working via the REST API
    // directly) but are never delivered to this listener — indistinguishable
    // from "the message didn't send" without this log.
    const channel = supabase
      .channel(`chat:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `room_id=eq.${roomId}` },
        (payload) => setMessages((prev) => {
          const incoming = payload.new as ChatMessage
          return prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
        })
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error(`[chat] realtime subscription ${status} for room ${roomId}:`, err)
        }
      })

    return () => { supabase.removeChannel(channel) }
  }, [roomId])

  const sendMessage = useCallback(async (message: string, displayName: string) => {
    setLoading(true)
    // getSession() reads from local storage — no server roundtrip needed for a chat insert
    const { data: { session } } = await supabase.auth.getSession()

    // auth_user_id, NOT user_id: user_id FKs to the legacy public.users table,
    // but session.user.id is an auth.users id — no auth user has a row in
    // public.users, so writing it to user_id violated the FK and the insert
    // was rejected. Net effect: every SIGNED-IN user's messages silently
    // failed to send, while guests (null user_id) worked fine — which made
    // it look like "chat is broken" only for authenticated accounts.
    // auth_user_id is the bridge column 001_auth_system.sql added for
    // exactly this, with the correct FK to auth.users.
    const { error } = await supabase.from('chat_messages').insert({
      room_id: roomId,
      auth_user_id: session?.user?.id ?? null,
      display_name: displayName,
      message,
    })
    if (error) console.error('[chat] sendMessage insert failed:', error.message)
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
