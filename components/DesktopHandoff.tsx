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
// For visitors who don't have the app yet, an OS-aware "Don't have it?
// Download…" link sits beneath the button and opens a download panel offering
// macOS, Windows and Linux installers (see DOWNLOAD_CATALOG below).
//
// It is always optional — a web-only user simply ignores it (see point 2 of the
// auth plan). Nothing here force-redirects, and neither the button nor the
// download link render inside the Electron renderer (there is no one to hand
// off to, and no point downloading the app you're already running).

import { useState, useEffect, useCallback } from 'react'
import { Monitor, Download, X, TriangleAlert } from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { useAuth, API_BASE } from '../livekit_react_hooks'

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
// Each platform ships its native installer directly: `npm run
// electron:build:mac` / `electron:build:win` / `electron:build:linux` produce
// the .dmg / .exe / .AppImage+.deb+.rpm, each published as a direct-download
// asset on a GitHub Release (not the Releases *page* — the asset URL itself,
// so clicking it starts the download immediately with no extra click-through).
// These binaries are too large for a git commit (100MB+, over GitHub's 100MB
// per-file git limit), which is why they're published as release assets
// instead of shipped in `public/`.
// VITE_DESKTOP_DOWNLOAD_{MAC,WIN}_URL let a deployment override with a
// differently-hosted binary.
//
// Windows ships one combined installer covering both x64 and arm64 (Surface
// Pro X and similar Windows-on-ARM devices) — electron-builder's NSIS target
// supports building a genuine multi-arch installer in one pass
// (package.json's electron:build:win runs `electron-builder --win --x64
// --arm64`, which produces this combined BeeHive-Setup.exe *alongside*
// separate BeeHive-Setup-x64.exe/BeeHive-Setup-arm64.exe — only the combined
// one is linked here). It detects the machine's actual architecture at
// install time and installs the matching payload, the same "one download,
// works everywhere" property as macOS's universal .dmg — confirmed by size:
// the combined installer is ~222MB, matching the sum of both per-arch
// payloads (~115MB + ~108MB), not just one of them.
//
// Linux ships the three formats electron-builder can produce natively from
// the existing Electron app (no second desktop framework): AppImage (portable,
// download-and-run), .deb (Debian/Ubuntu/Mint) and .rpm (Fedora/openSUSE), for
// both x86_64 and arm64. See package.json's `build.linux`.
//
// Stable, version-less asset names on GitHub's `latest` release alias — the
// app version is now git-derived and changes every build (see
// scripts/appVersion.mjs), so the OLD version-in-filename URLs
// (BeeHive-1.0.0-arm64.dmg on a v1.0.0 tag) would break on every bump. These
// URLs never change: `releases/latest/download/<stable-name>` always resolves
// to the newest published release's matching asset, and the build now emits
// exactly these names (see package.json build.mac/win/linux.artifactName).
// Publish a new build by clobbering the asset on the latest release — the URL
// stays put. macOS ships one universal binary (arm64 + x86_64 in one .dmg).
const GITHUB_LATEST = 'https://github.com/SaphoM/beehive/releases/latest/download'

// Fallback (build-time) URLs. Availability is confirmed at runtime against
// the backend's /updates/downloads manifest — a button is only shown for a
// file the manifest lists, so these constants are never a promise that a
// given artifact exists (see useDownloadManifest).
const DEFAULT_URLS = {
  macDmg: `${GITHUB_LATEST}/BeeHive-universal.dmg`,
  winExe: `${GITHUB_LATEST}/BeeHive-Setup.exe`,
  linuxAppImageX64: `${GITHUB_LATEST}/BeeHive-x86_64.AppImage`,
  linuxAppImageArm64: `${GITHUB_LATEST}/BeeHive-arm64.AppImage`,
  linuxDebX64: `${GITHUB_LATEST}/BeeHive-amd64.deb`,
  linuxDebArm64: `${GITHUB_LATEST}/BeeHive-arm64.deb`,
  linuxRpmX64: `${GITHUB_LATEST}/BeeHive-x86_64.rpm`,
  linuxRpmArm64: `${GITHUB_LATEST}/BeeHive-aarch64.rpm`,
}

type OsKey = 'mac' | 'windows' | 'linux'

interface DownloadArtifact {
  // The published asset filename — the join key against the update manifest.
  file: string
  url: string
  format: string        // e.g. 'AppImage', 'Debian (.deb)'
  arch: 'universal' | 'x64' | 'arm64'
  install: string       // one-line install instructions
  note?: string         // distribution-specific caveat
}

interface DownloadOs {
  key: OsKey
  label: string
  icon: React.ReactNode
  artifacts: DownloadArtifact[]
}

const MAC_ICON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
    <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>
)
const WINDOWS_ICON = (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
    <path d="M0,0H11.377V11.372H0ZM12.623,0H24V11.372H12.623ZM0,12.623H11.377V24H0Zm12.623,0H24V24H12.623" />
  </svg>
)
// Tux (simple-icons "linux").
const LINUX_ICON = (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
    <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z" />
  </svg>
)

// Every platform/format BeeHive publishes, plus the install instructions the
// published package actually needs. `file` MUST match the electron-builder
// artifact name exactly — it is what the update manifest is keyed on.
const DOWNLOAD_CATALOG: DownloadOs[] = [
  {
    key: 'mac', label: 'macOS', icon: MAC_ICON,
    artifacts: [{
      file: 'BeeHive-universal.dmg',
      url: (import.meta.env.VITE_DESKTOP_DOWNLOAD_MAC_URL as string | undefined) || DEFAULT_URLS.macDmg,
      format: 'DMG', arch: 'universal',
      install: 'Open the downloaded .dmg, then drag BeeHive into Applications.',
      note: 'First launch: right-click BeeHive → Open (once), since the app is self-distributed.',
    }],
  },
  {
    key: 'windows', label: 'Windows', icon: WINDOWS_ICON,
    artifacts: [{
      file: 'BeeHive-Setup.exe',
      url: (import.meta.env.VITE_DESKTOP_DOWNLOAD_WIN_URL as string | undefined) || DEFAULT_URLS.winExe,
      format: 'Installer (.exe)', arch: 'universal',
      install: 'Run the installer and follow the prompts.',
      note: 'First launch: if SmartScreen warns, click “More info” → “Run anyway”.',
    }],
  },
  {
    key: 'linux', label: 'Linux', icon: LINUX_ICON,
    artifacts: [
      {
        file: 'BeeHive-x86_64.AppImage', url: DEFAULT_URLS.linuxAppImageX64,
        format: 'AppImage', arch: 'x64',
        install: 'chmod +x BeeHive-x86_64.AppImage && ./BeeHive-x86_64.AppImage',
        note: 'Needs FUSE 2. If it fails to mount, install libfuse2 (Ubuntu/Debian/Mint) or fuse-libs (Fedora).',
      },
      {
        file: 'BeeHive-arm64.AppImage', url: DEFAULT_URLS.linuxAppImageArm64,
        format: 'AppImage', arch: 'arm64',
        install: 'chmod +x BeeHive-arm64.AppImage && ./BeeHive-arm64.AppImage',
        note: 'Needs FUSE 2. If it fails to mount, install libfuse2 (Ubuntu/Debian/Mint) or fuse-libs (Fedora).',
      },
      {
        file: 'BeeHive-amd64.deb', url: DEFAULT_URLS.linuxDebX64,
        format: 'Debian (.deb)', arch: 'x64',
        install: 'sudo apt install ./BeeHive-amd64.deb',
        note: 'Ubuntu, Debian, Linux Mint and compatible distributions.',
      },
      {
        file: 'BeeHive-arm64.deb', url: DEFAULT_URLS.linuxDebArm64,
        format: 'Debian (.deb)', arch: 'arm64',
        install: 'sudo apt install ./BeeHive-arm64.deb',
        note: 'Ubuntu, Debian, Linux Mint and compatible distributions.',
      },
      {
        file: 'BeeHive-x86_64.rpm', url: DEFAULT_URLS.linuxRpmX64,
        format: 'RPM (.rpm)', arch: 'x64',
        install: 'sudo dnf install ./BeeHive-x86_64.rpm',
        note: 'Fedora / openSUSE: use sudo zypper install ./BeeHive-x86_64.rpm instead.',
      },
      {
        file: 'BeeHive-aarch64.rpm', url: DEFAULT_URLS.linuxRpmArm64,
        format: 'RPM (.rpm)', arch: 'arm64',
        install: 'sudo dnf install ./BeeHive-aarch64.rpm',
        note: 'Fedora / openSUSE: use sudo zypper install ./BeeHive-aarch64.rpm instead.',
      },
    ],
  },
]

// Detects the visitor's desktop OS for the download CTA. Touch-primary devices
// (phones, tablets — including iPadOS, which reports navigator.platform as
// "MacIntel" when requesting the desktop site) are excluded: there is no
// desktop app to offer them.
export type DesktopOS = 'mac' | 'windows' | 'linux' | 'other'

export function detectDesktopOS(): DesktopOS {
  if (typeof navigator === 'undefined' || typeof matchMedia === 'undefined') return 'other'
  if (matchMedia('(pointer: coarse)').matches) return 'other'
  const platform = (navigator.platform || '').toLowerCase()
  const ua = navigator.userAgent.toLowerCase()
  if (platform.includes('mac') || ua.includes('mac os')) return 'mac'
  if (platform.includes('win') || ua.includes('windows')) return 'windows'
  if (platform.includes('linux') || ua.includes('linux') || ua.includes('x11')) return 'linux'
  return 'other'
}

// Best-effort architecture detection, used only to highlight the matching
// Linux/Windows artifact as "Recommended". Browsers freeze/mask this (Apple
// Silicon Safari still reports "Intel Mac OS X"), so it is never used to hide
// an option — every architecture remains a manual choice.
export function detectArch(): 'x64' | 'arm64' | 'unknown' {
  if (typeof navigator === 'undefined') return 'unknown'
  const ua = (navigator.userAgent || '').toLowerCase()
  if (/(aarch64|arm64|armv8)/.test(ua)) return 'arm64'
  if (/(x86_64|x64|amd64|win64|wow64)/.test(ua)) return 'x64'
  return 'unknown'
}

// The backend serves update-config.json (the same file electron-updater reads)
// at /updates/downloads: the authoritative list of assets that were actually
// built and published for the current release, with their real sizes. The
// download panel only renders a button for a file this manifest confirms, so
// it can never offer a link to a file that wasn't published.
interface DownloadManifest {
  status: 'loading' | 'ready' | 'error'
  version: string | null
  // filename → byte size
  sizes: Record<string, number>
}

function useDownloadManifest(): DownloadManifest {
  const [state, setState] = useState<DownloadManifest>({ status: 'loading', version: null, sizes: {} })
  useEffect(() => {
    let cancelled = false
    fetch(`${API_BASE}/updates/downloads`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { version?: string; downloads?: Array<{ file: string; size: number }> }) => {
        if (cancelled) return
        const sizes: Record<string, number> = {}
        for (const d of data.downloads ?? []) if (d?.file) sizes[d.file] = d.size
        setState({ status: 'ready', version: data.version ?? null, sizes })
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', version: null, sizes: {} }) })
    return () => { cancelled = true }
  }, [])
  return state
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

function osLabel(os: DesktopOS): string {
  return os === 'mac' ? 'macOS' : os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : 'your desktop'
}

// Button offering to continue in the desktop app, with a "download it" fallback
// underneath for visitors who don't have it installed yet. Renders nothing on
// the desktop app itself or when the feature is disabled, so it is safe to
// mount anywhere.
export function OpenDesktopAppButton({ style }: { style?: React.CSSProperties }) {
  const { session } = useAuth()
  const [opening, setOpening] = useState(false)
  const [showDownload, setShowDownload] = useState(false)
  const os = detectDesktopOS()
  // Best-effort only — see detectDesktopOS/detectArch.
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

      {/* Touch-primary devices have no desktop app to offer them. */}
      {os !== 'other' && (
        <button
          onClick={() => setShowDownload(true)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            background: 'none', border: 'none', padding: '2px 4px',
            color: '#555', fontSize: 11, fontFamily: "'Roboto', sans-serif", fontWeight: 300,
            cursor: 'pointer',
          }}
        >
          <Download size={11} />
          Don't have it? Download for {osLabel(os)}
        </button>
      )}

      {showDownload && (
        <DesktopDownloadModal initialOs={os === 'other' ? 'mac' : os} onClose={() => setShowDownload(false)} />
      )}
    </div>
  )
}

// ---- Download modal --------------------------------------------------------

function DesktopDownloadModal({ initialOs, onClose }: { initialOs: OsKey; onClose: () => void }) {
  const manifest = useDownloadManifest()
  const detectedArch = detectArch()
  const [os, setOs] = useState<OsKey>(initialOs)
  const [starting, setStarting] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const start = useCallback((file: string) => {
    setStarting(file)
    // Downloads are handed to the browser's own download manager; the button
    // just acknowledges the click for a moment so it doesn't look inert.
    setTimeout(() => setStarting(prev => (prev === file ? null : prev)), 4000)
  }, [])

  const active = DOWNLOAD_CATALOG.find(o => o.key === os)!
  // A file is offered only when the manifest lists it. While the manifest is
  // loading we show a "checking" hint; if it fails, we fall back to the
  // published stable URLs but say the sizes couldn't be verified.
  const availabilityFor = (file: string): 'available' | 'unavailable' | 'unverified' => {
    if (manifest.status === 'ready') return file in manifest.sizes ? 'available' : 'unavailable'
    return 'unverified'
  }

  return (
    <div
      onClick={onClose}
      style={{
        WebkitAppRegion: 'no-drag' as any,
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, fontFamily: "'Roboto', sans-serif",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 440, maxHeight: '86vh', overflowY: 'auto',
          background: '#111', border: '1px solid #1e1e1e', borderRadius: 14,
          padding: '18px 20px 20px', boxShadow: '0 20px 60px rgba(0,0,0,0.75)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ color: '#fff', fontSize: 15, fontWeight: 600 }}>Download BeeHive</div>
            <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
              {manifest.version ? `Latest release v${manifest.version}` : 'Desktop app for macOS, Windows and Linux'}
            </div>
          </div>
          <button onClick={onClose} title="Close" style={{
            background: 'none', border: '1px solid #2a2a2a', borderRadius: 8, color: '#888',
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}>
            <X size={14} />
          </button>
        </div>

        {/* OS selector — manual choice, preselected from detection. */}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          {DOWNLOAD_CATALOG.map(item => {
            const selected = item.key === os
            return (
              <button
                key={item.key}
                onClick={() => setOs(item.key)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '9px 6px', borderRadius: 10, cursor: 'pointer',
                  background: selected ? 'rgba(245,166,35,0.12)' : 'transparent',
                  border: `1px solid ${selected ? '#f5a623' : '#242424'}`,
                  color: selected ? '#f5a623' : '#888', fontSize: 12, fontWeight: 500,
                }}
              >
                {item.icon}
                {item.label}
              </button>
            )
          })}
        </div>

        {manifest.status === 'loading' && (
          <div style={{ color: '#666', fontSize: 11, marginTop: 12 }}>Checking the latest release…</div>
        )}
        {manifest.status === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#c99', fontSize: 11, marginTop: 12 }}>
            <TriangleAlert size={12} />
            Couldn't verify the latest build — sizes are unavailable. Downloads still use the latest published release.
          </div>
        )}

        {/* Artifacts for the selected OS. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {active.artifacts.map(a => {
            const availability = availabilityFor(a.file)
            const size = manifest.sizes[a.file]
            const recommended = a.arch !== 'universal' && a.arch === detectedArch
            return (
              <div key={a.file} style={{ border: '1px solid #1e1e1e', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#eee', fontSize: 13, fontWeight: 500 }}>
                      {a.format}
                      <span style={{ color: '#666', fontWeight: 400 }}> · {a.arch === 'universal' ? 'Universal' : a.arch}</span>
                      {recommended && (
                        <span style={{ marginLeft: 8, color: '#48bb78', fontSize: 10, fontWeight: 600, verticalAlign: 'middle' }}>RECOMMENDED</span>
                      )}
                    </div>
                    <div style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                      {a.file}{size ? ` · ${formatBytes(size)}` : ''}
                    </div>
                  </div>
                  {availability === 'unavailable' ? (
                    <span style={{ color: '#666', fontSize: 11, whiteSpace: 'nowrap' }}>Not in this release</span>
                  ) : (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => start(a.file)}
                      style={{
                        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                        background: '#f5a623', color: '#111', textDecoration: 'none',
                        borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 600,
                      }}
                    >
                      <Download size={13} />
                      {starting === a.file ? 'Starting…' : 'Download'}
                    </a>
                  )}
                </div>
                <div style={{
                  marginTop: 8, background: '#0c0c0c', border: '1px solid #1a1a1a', borderRadius: 7,
                  padding: '7px 9px', color: '#8fb', fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  wordBreak: 'break-all',
                }}>
                  {a.install}
                </div>
                {a.note && <div style={{ color: '#777', fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>{a.note}</div>}
              </div>
            )
          })}
        </div>

        <div style={{ color: '#444', fontSize: 10, marginTop: 14, lineHeight: 1.5 }}>
          SHA-512 checksums for every artifact are published with each release. macOS and Windows builds are
          ad-hoc signed, not notarised, so a one-time OS security prompt is expected on first launch.
        </div>
      </div>
    </div>
  )
}
