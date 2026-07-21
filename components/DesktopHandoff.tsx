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

import { useState, useEffect } from 'react'
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

// The meeting invite currently in the web page's URL (?room=ID), if any —
// carried into the deep link so "Open in desktop app" continues into the
// SAME meeting rather than dropping the user in the desktop lobby. Lives in
// the deep link's *query* (electron/main.cjs's handleDeepLink forwards all
// query params through to the renderer verbatim, where RoomPage reads
// ?room= on mount exactly as it does on the web); the *hash* stays
// reserved for auth tokens.
function currentRoomQuery(): string {
  const room = new URLSearchParams(window.location.search).get('room')
  return room ? `?room=${encodeURIComponent(room)}` : ''
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
  return `beehive://auth/confirm${currentRoomQuery()}#${new URLSearchParams(params).toString()}`
}

// Launch the desktop app. With a session, the app opens signed in; without one
// it opens to its own sign-in. Any ?room= invite in the current page's URL is
// carried through either way. If the app isn't installed the OS simply ignores
// the beehive:// navigation, so this is safe to call unconditionally.
export function openInDesktopApp(session: Session | null): void {
  if (!canOfferDesktopHandoff()) return
  window.location.href = session ? buildDesktopHandoffUrl(session) : `beehive://${currentRoomQuery()}`
}

// ============================================================
// DOWNLOAD — offer the installer for a visitor who doesn't have the app yet
// ============================================================
// Both macOS and Windows ship their native installer directly: `npm run
// electron:build:mac` / `electron:build:win` produce the .dmg / .exe, each
// published as a direct-download asset on a GitHub Release (not the Releases
// *page* — the asset URL itself, so clicking it starts the download
// immediately with no extra click-through). These binaries are too large for
// a git commit (100MB+, over GitHub's 100MB per-file git limit), which is why
// they're published as release assets instead of shipped in `public/`.
// VITE_DESKTOP_DOWNLOAD_{MAC,WIN}_URL let a deployment override with a
// differently-hosted binary.
//
// Windows ships the x64 installer (the standard architecture for the vast
// majority of Windows PCs) — an arm64 build also exists for Windows-on-ARM
// devices (Surface Pro X and similar) but isn't linked here, matching
// detectDesktopOS()'s OS-level (not architecture-level) detection below.
// Stable, version-less asset names on GitHub's `latest` release alias — the
// app version is now git-derived and changes every build (see
// scripts/appVersion.mjs), so the OLD version-in-filename URLs
// (BeeHive-1.0.0-arm64.dmg on a v1.0.0 tag) would break on every bump. These
// URLs never change: `releases/latest/download/<stable-name>` always resolves
// to the newest published release's matching asset, and the build now emits
// exactly these names (see package.json build.mac/win.artifactName). Publish a
// new build by clobbering the asset on the latest release — the URL stays put.
const NATIVE_MAC_DMG_URL = 'https://github.com/SaphoM/beehive/releases/latest/download/BeeHive-arm64.dmg'
const NATIVE_WIN_EXE_URL = 'https://github.com/SaphoM/beehive/releases/latest/download/BeeHive-Setup-x64.exe'
const DOWNLOAD_URLS: Record<'mac' | 'windows', string> = {
  mac: (import.meta.env.VITE_DESKTOP_DOWNLOAD_MAC_URL as string | undefined) || NATIVE_MAC_DMG_URL,
  windows: (import.meta.env.VITE_DESKTOP_DOWNLOAD_WIN_URL as string | undefined) || NATIVE_WIN_EXE_URL,
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

// ============================================================
// macOS ARCHITECTURE — Apple Silicon vs Intel
// ============================================================
// No browser exposes CPU architecture directly to a web page on macOS, so
// this is necessarily best-effort ("detect where possible" — there is no
// guaranteed signal). Only Apple Silicon `.dmg`s have ever been published
// for this app (confirmed: no Intel/x64 mac build exists), so an Intel Mac
// visitor was previously served the exact same arm64 installer as everyone
// else — one that simply will not launch on their machine, with no
// indication anything was wrong. This distinguishes the two cases so an
// Intel visitor gets an honest message instead of a broken download.
export type MacArch = 'apple-silicon' | 'intel' | 'unknown'

// Synchronous, works in every browser (Safari included) that exposes WebGL —
// the GPU renderer string reported by Apple Silicon's integrated GPU always
// names the chip ("Apple M1/M2/M3/M4 Pro" etc. or the generic "Apple GPU"),
// while Intel Macs report their Intel/AMD/Nvidia GPU model instead. This is
// the only architecture signal available in Safari and Firefox, neither of
// which implements the Client Hints API used below.
function detectMacArchViaWebGL(): MacArch {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return 'unknown'
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : ''
    if (!renderer) return 'unknown'
    if (/Apple\s*M\d/i.test(renderer) || /Apple GPU/i.test(renderer)) return 'apple-silicon'
    if (/Intel|AMD|Radeon|NVIDIA|GeForce/i.test(renderer)) return 'intel'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// Async, higher-confidence when available — Chrome/Edge's User-Agent Client
// Hints expose `architecture` ('arm' | 'x86') directly via a permission-free
// API. Safari and Firefox don't implement this at all, so this only ever
// refines (never contradicts a confident WebGL read with a wrong answer;
// callers apply it as a secondary check, not a replacement).
async function refineMacArchViaClientHints(): Promise<MacArch> {
  try {
    const uaData = (navigator as any).userAgentData
    if (!uaData?.getHighEntropyValues) return 'unknown'
    const { architecture } = await uaData.getHighEntropyValues(['architecture'])
    if (architecture === 'arm') return 'apple-silicon'
    if (architecture === 'x86') return 'intel'
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

// Button offering to continue in the desktop app, with a "download it" fallback
// underneath for visitors who don't have it installed yet. Renders nothing on
// the desktop app itself or when the feature is disabled, so it is safe to
// mount anywhere.
export function OpenDesktopAppButton({ style }: { style?: React.CSSProperties }) {
  const { session } = useAuth()
  const [opening, setOpening] = useState(false)
  const os = detectDesktopOS()
  // Best-effort only — see detectMacArchViaWebGL/refineMacArchViaClientHints.
  // Seeded synchronously from the WebGL heuristic (works in every browser),
  // then refined once the async Client Hints check resolves where that's
  // available (Chrome/Edge only, higher confidence) — never regresses a
  // confident WebGL read back to 'unknown'.
  const [macArch, setMacArch] = useState<MacArch>(() => (os === 'mac' ? detectMacArchViaWebGL() : 'unknown'))
  useEffect(() => {
    if (os !== 'mac') return
    let cancelled = false
    refineMacArchViaClientHints().then(a => { if (!cancelled && a !== 'unknown') setMacArch(a) })
    return () => { cancelled = true }
  }, [os])

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

      {/* Only Apple Silicon `.dmg`s have ever been published for this app — no
          Intel/x64 mac build exists. Serving that installer to a detected
          Intel Mac would silently hand them a binary that can't launch, so
          this is the one case where the download link itself is withheld in
          favor of an honest message, rather than a broken "download". */}
      {os === 'mac' && macArch === 'intel' ? (
        <span
          style={{
            display: 'block', textAlign: 'center',
            color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300,
            lineHeight: 1.4, padding: '4px 4px 2px',
          }}
        >
          BeeHive's desktop app currently supports Apple Silicon Macs (M1 and newer) only.
        </span>
      ) : (os === 'mac' || os === 'windows') && (
        <>
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
          {/* First-launch bypass hint. BeeHive is self-distributed and only
              ad-hoc code-signed (no paid Apple Developer ID / Windows
              publisher cert), so a plain double-click after download is
              blocked by macOS Gatekeeper ("cannot verify developer") /
              Windows SmartScreen. Without telling the user the one-time
              bypass, download succeeds but INSTALL dead-ends — this line is
              what makes the install actually complete. See INSTALL_HINT. */}
          <span
            style={{
              display: 'block', textAlign: 'center',
              color: '#444', fontSize: 10, fontFamily: "'Roboto', sans-serif", fontWeight: 300,
              lineHeight: 1.4, padding: '0 4px',
            }}
          >
            {os === 'mac'
              ? 'First launch: right-click BeeHive → Open (once), since the app is self-distributed.'
              : 'First launch: if SmartScreen warns, click “More info” → “Run anyway”.'}
          </span>
        </>
      )}
    </div>
  )
}
