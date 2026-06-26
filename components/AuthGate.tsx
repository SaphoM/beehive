import { ReactNode } from 'react'
import { useAuth } from '../livekit_react_hooks'
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

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  // Supabase processes the magic link token automatically via onAuthStateChange;
  // while that is happening, show nothing (avoids flash of auth screen).
  if (loading || isAuthCallback()) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100%', height: 'var(--vh, 100vh)', background: '#0a0a0a',
      }}>
        <span style={{ color: '#444', fontSize: 13, letterSpacing: 2 }}>LOADING…</span>
      </div>
    )
  }

  // Frictionless join: ?room= links skip auth entirely
  if (!user && hasRoomParam()) {
    return <>{children}</>
  }

  // Not authenticated and no room param → show auth screen
  if (!user) {
    return <AuthScreen />
  }

  // Authenticated
  return <>{children}</>
}
