import { ReactNode, useState, useEffect } from 'react'
import { useAuth, supabase } from '../livekit_react_hooks'
import { AuthScreen } from './AuthScreen'

// URL params that bypass auth (frictionless room join)
function hasRoomParam(): boolean {
  const params = new URLSearchParams(window.location.search)
  return !!params.get('room')
}

// Auth confirmation flow: Supabase redirects back with ?auth=confirm or a hash token
function isAuthCallback(): boolean {
  const params = new URLSearchParams(window.location.search)
  const hash = window.location.hash
  return params.get('auth') === 'confirm' ||
    hash.includes('access_token') ||
    hash.includes('type=magiclink')
}

const spinner = (
  <div style={{
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: '100%', height: 'var(--vh, 100vh)', background: '#0a0a0a',
  }}>
    <span style={{ color: '#444', fontSize: 13, letterSpacing: 2 }}>LOADING…</span>
  </div>
)

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  // Capture once on mount — URL will be cleaned by Supabase SDK after processing,
  // so re-reading window.location on every render would give stale results anyway.
  const [wasCallback] = useState(isAuthCallback)
  const [callbackSettled, setCallbackSettled] = useState(false)
  // Same reasoning applies here, and this one was missed: hasRoomParam() was
  // being called fresh in the render body every time (below), not cached —
  // so if AuthGate re-rendered for ANY reason after Supabase's own async
  // session/URL processing ran (which is guaranteed to happen at least once,
  // as `loading` settles), the live URL no longer had `?room=`, this
  // re-evaluated to false, and AuthGate swapped the entire child tree for
  // <AuthScreen /> instead of ever reaching RoomPage. This was the actual
  // cause of "invite link doesn't carry through to desktop": the deep link's
  // ?room= was present in the URL at load, survived long enough for the
  // FIRST render, but was gone by the time this component's later render(s)
  // re-checked it live. Verified directly: a room param that's read once
  // here and cached survives regardless of how many times the URL changes
  // afterward; reading it fresh each render does not.
  const [hadRoomParam] = useState(hasRoomParam)

  // Consume an auth callback / desktop-handoff hash. We explicitly set the
  // session from access_token+refresh_token so this works even when Supabase's
  // built-in detectSessionInUrl doesn't — notably the desktop beehive:// handoff,
  // whose hash the web app constructs itself. Critically, always settle so the
  // spinner can never hang: if no session results, fall through to the sign-in
  // screen instead of showing "LOADING…" forever.
  useEffect(() => {
    if (!wasCallback) return
    let cancelled = false
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const access_token = hash.get('access_token')
    const refresh_token = hash.get('refresh_token')
    const settle = () => { if (!cancelled) setCallbackSettled(true) }
    if (access_token && refresh_token) {
      supabase.auth.setSession({ access_token, refresh_token })
        .finally(() => setTimeout(settle, 300))
    } else {
      // Let Supabase's own detectSessionInUrl resolve, then stop spinning.
      setTimeout(settle, 1500)
    }
    return () => { cancelled = true }
  }, [wasCallback])

  // User is resolved — render immediately regardless of URL state.
  // Supabase may not have cleaned the hash yet, but the session is valid.
  if (!loading && user) return <>{children}</>

  // Waiting for the initial session to be determined
  if (loading) return spinner

  // Auth callback / handoff in progress — spinner until the session settles
  // (bounded above, so this cannot hang).
  if (wasCallback && !callbackSettled) return spinner

  // Frictionless join: ?room= links skip auth entirely
  if (hadRoomParam) return <>{children}</>

  // Not authenticated → show sign-in screen
  return <AuthScreen />
}
