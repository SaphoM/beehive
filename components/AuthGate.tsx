import { ReactNode, useState } from 'react'
import { useAuth } from '../livekit_react_hooks'
import { AuthScreen } from './AuthScreen'
import { DesktopHandoffPrompt } from './DesktopHandoff'

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
  const { user, session, loading } = useAuth()
  // Capture once on mount — URL will be cleaned by Supabase SDK after processing,
  // so re-reading window.location on every render would give stale results anyway.
  const [wasCallback] = useState(isAuthCallback)

  // User is resolved — render immediately regardless of URL state.
  // Supabase may not have cleaned the hash yet, but the session is valid.
  // DesktopHandoffPrompt is a disabled stub today (renders null); it will offer
  // web users the option to continue in the desktop app once activated.
  if (!loading && user) return <>{children}<DesktopHandoffPrompt session={session} /></>

  // Waiting for the initial session to be determined
  if (loading) return spinner

  // Magic-link callback in progress — Supabase is still processing the token
  if (wasCallback) return spinner

  // Frictionless join: ?room= links skip auth entirely
  if (hasRoomParam()) return <>{children}</>

  // Not authenticated → show sign-in screen
  return <AuthScreen />
}
