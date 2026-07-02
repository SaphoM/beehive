// ============================================================
// DESKTOP HANDOFF — web → desktop app sign-in bridge
// ============================================================
// When a user is on the WEB but also has the BeeHive desktop app installed,
// this offers a button to continue in the desktop app. If the user is signed
// in on the web, the authenticated Supabase session is handed across the
// `beehive://` deep link (parsed by electron/main.cjs → handleDeepLink) so the
// desktop app opens already signed in. If not signed in, the app opens to its
// own sign-in screen.
//
// It is always optional — a web-only user simply ignores it (see point 2 of the
// auth plan). Nothing here force-redirects, and the button never renders inside
// the Electron renderer (there is no one to hand off to).

import { useState } from 'react'
import { Monitor } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { useAuth } from '../livekit_react_hooks'

// Master switch. Set false to hide the handoff button everywhere.
export const ENABLE_DESKTOP_HANDOFF = true

// True only in a real browser (never inside the Electron renderer, which is
// already the desktop app).
export function canOfferDesktopHandoff(): boolean {
  if (!ENABLE_DESKTOP_HANDOFF) return false
  if (typeof window === 'undefined') return false
  if ((window as unknown as { electronAPI?: unknown }).electronAPI) return false
  return true
}

// Build the deep link that opens the desktop app with the given session.
// Tokens live in the URL *hash* so they are never sent to a server or captured
// in server access logs — same reasoning as the web auth-callback flow.
export function buildDesktopHandoffUrl(session: Session): string {
  const hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    type: 'magiclink',
  }).toString()
  return `beehive://auth/confirm#${hash}`
}

// Launch the desktop app. With a session, the app opens signed in; without one
// it opens to its own sign-in. If the app isn't installed the OS simply ignores
// the beehive:// navigation, so this is safe to call unconditionally.
export function openInDesktopApp(session: Session | null): void {
  if (!canOfferDesktopHandoff()) return
  window.location.href = session ? buildDesktopHandoffUrl(session) : 'beehive://'
}

// Button offering to continue in the desktop app. Renders nothing on the desktop
// app itself or when the feature is disabled, so it is safe to mount anywhere.
export function OpenDesktopAppButton({ style }: { style?: React.CSSProperties }) {
  const { session } = useAuth()
  const [opening, setOpening] = useState(false)

  if (!canOfferDesktopHandoff()) return null

  function handleOpen() {
    setOpening(true)
    openInDesktopApp(session)
    // The desktop app takes focus on success; if it isn't installed nothing
    // happens, so re-enable the button after a short delay either way.
    setTimeout(() => setOpening(false), 4000)
  }

  return (
    <button
      onClick={handleOpen}
      disabled={opening}
      title="Continue in the BeeHive desktop app"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10,
        color: '#888', fontSize: 12, fontFamily: "'Roboto', sans-serif", fontWeight: 300,
        padding: '10px 14px', cursor: opening ? 'default' : 'pointer', width: '100%',
        transition: 'border-color 0.2s, color 0.2s',
        ...style,
      }}
    >
      <Monitor size={14} />
      {opening ? 'Opening BeeHive…' : 'Open in desktop app'}
    </button>
  )
}
