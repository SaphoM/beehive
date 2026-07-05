// ============================================================
// DESKTOP HANDOFF — web → desktop app sign-in bridge + installer download
// ============================================================
// When a user is on the WEB but also has the BeeHive desktop app installed,
// this offers a button to continue in the desktop app. If the user is signed
// in on the web, the authenticated Supabase session is handed across the
// `beehive://` deep link (parsed by electron/main.cjs → handleDeepLink) so the
// desktop app opens already signed in. If not signed in, the app opens to its
// own sign-in screen.
//
// For visitors who don't have the app yet, an OS-aware "Download for
// macOS/Windows" link sits beneath the button (see DOWNLOAD_URLS below).
//
// It is always optional — a web-only user simply ignores it (see point 2 of the
// auth plan). Nothing here force-redirects, and neither the button nor the
// download link render inside the Electron renderer (there is no one to hand
// off to, and no point downloading the app you're already running).

import { useState } from 'react'
import { Monitor, Download } from 'lucide-react'
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
  // Carry the full token set so the desktop's Supabase detectSessionInUrl can
  // consume the hash natively; AuthGate also sets the session explicitly as a
  // fallback. Mirrors the shape of Supabase's own implicit-flow callback hash.
  const params: Record<string, string> = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type ?? 'bearer',
    type: 'magiclink',
  }
  if (session.expires_in != null) params.expires_in = String(session.expires_in)
  if (session.expires_at != null) params.expires_at = String(session.expires_at)
  return `beehive://auth/confirm#${new URLSearchParams(params).toString()}`
}

// Launch the desktop app. With a session, the app opens signed in; without one
// it opens to its own sign-in. If the app isn't installed the OS simply ignores
// the beehive:// navigation, so this is safe to call unconditionally.
export function openInDesktopApp(session: Session | null): void {
  if (!canOfferDesktopHandoff()) return
  window.location.href = session ? buildDesktopHandoffUrl(session) : 'beehive://'
}

// ============================================================
// DOWNLOAD — offer the installer for a visitor who doesn't have the app yet
// ============================================================
// macOS ships the native installer directly: `npm run electron:build:mac`
// produces the .dmg, published as a direct-download asset on a GitHub Release
// (not the Releases *page* — the asset URL itself, so clicking it starts the
// download immediately with no extra click-through). The .dmg is too large
// for a git commit (500MB+, over GitHub's 100MB per-file limit), which is why
// it's published as a release asset instead of shipped in `public/`.
// VITE_DESKTOP_DOWNLOAD_{MAC,WIN}_URL let a deployment override with a
// differently-hosted binary; Windows has no bundled installer yet, so it
// falls back to the repo's GitHub Releases page.
const GITHUB_RELEASES_URL = 'https://github.com/SaphoM/beehive/releases/latest'
const NATIVE_MAC_DMG_URL = 'https://github.com/SaphoM/beehive/releases/download/v1.0.0/BeeHive-1.0.0-arm64.dmg'
const DOWNLOAD_URLS: Record<'mac' | 'windows', string> = {
  mac: (import.meta.env.VITE_DESKTOP_DOWNLOAD_MAC_URL as string | undefined) || NATIVE_MAC_DMG_URL,
  windows: (import.meta.env.VITE_DESKTOP_DOWNLOAD_WIN_URL as string | undefined) || GITHUB_RELEASES_URL,
}

// Detects the visitor's desktop OS for the download CTA. Touch-primary devices
// (phones, tablets — including iPadOS, which reports navigator.platform as
// "MacIntel" when requesting the desktop site) are excluded: there is no
// desktop app to offer them.
export function detectDesktopOS(): 'mac' | 'windows' | 'other' {
  if (typeof navigator === 'undefined' || typeof matchMedia === 'undefined') return 'other'
  if (matchMedia('(pointer: coarse)').matches) return 'other'
  const platform = (navigator.platform || '').toLowerCase()
  const ua = navigator.userAgent.toLowerCase()
  if (platform.includes('mac') || ua.includes('mac os')) return 'mac'
  if (platform.includes('win') || ua.includes('windows')) return 'windows'
  return 'other'
}

// Button offering to continue in the desktop app, with a "download it" fallback
// underneath for visitors who don't have it installed yet. Renders nothing on
// the desktop app itself or when the feature is disabled, so it is safe to
// mount anywhere.
export function OpenDesktopAppButton({ style }: { style?: React.CSSProperties }) {
  const { session } = useAuth()
  const [opening, setOpening] = useState(false)
  const os = detectDesktopOS()

  if (!canOfferDesktopHandoff()) return null
  // Desktop-app access is limited to seed users and fully registered users
  // during the Beta — an authenticated Supabase session is the marker for
  // both (invite-link guests have none). Hide the whole block for guests.
  if (!session) return null

  function handleOpen() {
    setOpening(true)
    openInDesktopApp(session)
    // The desktop app takes focus on success; if it isn't installed nothing
    // happens, so re-enable the button after a short delay either way.
    setTimeout(() => setOpening(false), 4000)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', ...style }}>
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
        }}
      >
        <Monitor size={14} />
        {opening ? 'Opening BeeHive…' : 'Open in desktop app'}
      </button>

      {(os === 'mac' || os === 'windows') && (
        <a
          href={DOWNLOAD_URLS[os]}
          target="_blank"
          rel="noopener noreferrer"
          title={`Download the BeeHive desktop app for ${os === 'mac' ? 'macOS' : 'Windows'}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300,
            textDecoration: 'none', padding: '2px 4px',
          }}
        >
          <Download size={11} />
          Don't have it? Download for {os === 'mac' ? 'macOS' : 'Windows'}
        </a>
      )}
    </div>
  )
}
