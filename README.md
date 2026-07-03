# BEEHIVE
**X Spark Video Conferencing Platform**

> Real-time video meetings powered by LiveKit and Supabase.

---

## Overview

BeeHive is X Spark's video conferencing product. It supports two modes selectable from the lobby:

- **Meet** — standard video meetings
- **Sting** — alternative session mode

Built for scale: designed around the DUT (Durban University of Technology) use case of 50–200 concurrent users per lecture room.

Available as a **web app** and a **native desktop app** (Electron, macOS / Windows).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 8 |
| Video/Audio | LiveKit Cloud |
| Noise suppression | Krisp (`@livekit/krisp-noise-filter`) — background-noise filtering on the mic, lazy-loaded |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime subscriptions |
| Auth | Supabase Auth — Magic Link + Email OTP (no passwords) |
| Icons | Lucide React |
| Fonts | Roboto (Google Fonts) — Thin (100) / Light (300) / Regular (400) |
| Backend | Node.js + Express 5 |
| Meeting Intelligence | Fathom API |
| Background AI | MediaPipe Selfie Segmentation |
| Desktop | Electron 42 + electron-builder |
| Window activation | `beehive-ctl` native helper (`NSRunningApplication`) — bring the shared window's app to the foreground |

---

## Features

### Authentication

BeeHive uses **passwordless auth** — no passwords, ever.

| Flow | How it works |
|------|-------------|
| **Magic link** | Enter email → click link in email → signed in (web default) |
| **6-digit OTP** | Enter email → receive code → type code in app (Electron default; also available on web) |
| **Frictionless room join** | `?room=ID` links bypass auth entirely — guests join directly |
| **Post-meeting register** | Guests who joined via room link are prompted to register after the meeting ends (card-flip animation in lobby) |

**Roles:**

| Role | Who |
|------|-----|
| `admin` | sapho@xspark.co.za |
| `user` | All other team members |

Admin role is assigned automatically by the seed script. New self-registered users get the `user` role via a Supabase trigger on `auth.users`.

**Auth gate:** The `AuthGate` component wraps the entire app. `?room=` links skip the gate; all other routes require a session.

**Session persistence:** Sessions are stored in `localStorage` and survive page reloads. Default expiry: 1 week.

**Electron deep-link:** Magic links redirect to `beehive://auth/confirm#token=…`. Electron intercepts the URL scheme, extracts the token from the hash, and loads it into the renderer so Supabase can establish the session automatically.

**Web → Desktop sign-in handoff** (`components/DesktopHandoff.tsx`): an **"Open in desktop app"** button on the web lobby lets a signed-in web user continue in the BeeHive desktop app without re-entering their email:
- Clicking it navigates to `beehive://auth/confirm#access_token=…&refresh_token=…` — the desktop app picks up the hash and establishes the same session (`AuthGate` calls `supabase.auth.setSession(...)` explicitly, so it doesn't depend on Supabase's automatic `detectSessionInUrl`)
- Tokens travel in the URL **hash**, never sent to a server or logged
- If the desktop app isn't installed, the OS silently ignores the `beehive://` navigation — nothing breaks
- Only rendered in a real browser — it never appears inside the Electron app itself (`canOfferDesktopHandoff()` checks for `window.electronAPI`)
- Fully optional: a web-only user can simply ignore the button and keep using the web app

**Download the desktop app:** directly beneath the button, a small OS-aware **"Don't have it? Download for macOS / Windows"** link is shown to visitors on a real Mac or Windows desktop browser:
- OS is detected via `detectDesktopOS()` — checks `navigator.platform`/`userAgent`, and excludes touch-primary devices (`matchMedia('(pointer: coarse)')`) so phones and tablets never see a desktop-app download link — this specifically also excludes **iPadOS**, which reports `navigator.platform` as `"MacIntel"` when the device requests the desktop site, and would otherwise be misidentified as a Mac
- Link target is `VITE_DESKTOP_DOWNLOAD_MAC_URL` / `VITE_DESKTOP_DOWNLOAD_WIN_URL` if set, otherwise falls back to the repo's [GitHub Releases page](https://github.com/SaphoM/beehive/releases/latest)
- **Note:** this only builds the download *link* — it does not itself build, sign, or publish installers. Producing real downloadable artifacts is a separate, deliberate step: run `npm run electron:build:mac` / `electron:build:win` locally, then publish the resulting `release/*.dmg` / `release/*.exe` to a GitHub Release (or wherever `VITE_DESKTOP_DOWNLOAD_*_URL` points)

**Supabase URL configuration (required for production):**
- Site URL → `https://beehive-fu8w.onrender.com`
- Redirect URLs → `https://beehive-fu8w.onrender.com/**`, `http://localhost:5173/**`

---

### Invitations

Anyone in a meeting can invite anyone else — no account required on either side.

**Flow:**
1. Click **Link** (🔗) in the controls bar → `InviteModal` opens
2. The plain `?room=ROOM_ID` link is shown — click the link box or **Copy link** to copy it
3. Share the link with anyone (chat, email, Slack, etc.)
4. Recipient clicks it → goes straight to the lobby; no account required to join

> The same `?room=ROOM_ID` link is used whether the host is authenticated or a guest.

---

### Lobby

- **BEE**HIVE wordmark — `BEE` in Roboto Regular (400), `HIVE` in Roboto Thin (100)
- **Start Now / Schedule** tab switcher:
  - **Start Now** — Meet / Sting mode toggle; enter name; start immediately
  - **Schedule** — pick date + time, add attendee emails as chips, generate an invite link, copy it or send pre-filled email invites via the system mail client; room is created in Supabase up front so the link works immediately
- Invite preview — guests visiting a `?room=ROOM_ID` link see the room name and live participant count before joining
- **Register CTA** — unauthenticated guests see a "Register to save your history" button; clicking it card-flips the lobby card to a registration form (magic link or OTP)
- **Post-meeting register** — guests who joined via room link are prompted to register when they return to the lobby after a meeting ends (same card-flip animation)
- **User strip** — authenticated users see their name and a Sign out button at the top of the lobby card
- **Recent meetings** — expandable Fathom panel showing AI-summarised past meetings
- **Open in desktop app** — web-only button below "Recent meetings"; hands off the signed-in session to the BeeHive desktop app via the `beehive://` deep link, with an OS-aware "Download for macOS/Windows" fallback link for visitors who don't have it installed (see [Authentication](#authentication))

### In Meeting

#### Header — Desktop
| Element | Position | Notes |
|---------|----------|-------|
| **BEE**HIVE wordmark | Left | App name |
| Participant count pill | Left | Click to open Participants window |
| **Meeting timer** | Centre | Elapsed time in grey (`M:SS` / `H:MM:SS`); pointer-events none so it doesn't block dragging |
| Stop Sharing | Right | Green pill — only visible when actively sharing screen |
| Chat toggle | Right | Opens/closes chat sidebar |
| Leave | Right | Red; disconnects and returns to lobby |

#### Header — Mobile (≤ 640 px)
Compact single-row header; timer and secondary controls move elsewhere to save space.

| Element | Notes |
|---------|-------|
| **BEE**HIVE wordmark | Smaller font (12 px, letterSpacing 2); `whiteSpace: nowrap`; left side shrinks before right |
| Participant count pill | Shows full `N participant(s)` on phones > 430 px; shows count number only (e.g. `3`) on ≤ 430 px to prevent overflow |
| Leave | Compact red button (`flexShrink: 0`); always fully visible |
| Chat, Stop Sharing | Hidden from header — Chat accessible via scrollable controls bar |
| **Meeting timer** | Floating pill overlaid at the top-centre of the video area (not in the header) |

Header flex is `minWidth: 0` / `flexShrink: 1` on the left group and `flexShrink: 0` on the right — left content compresses, Leave button stays whole on every screen size.

#### Controls Bar — Desktop (left → right)
| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | LiveKit-managed; mute/unmute |
| Speaker | `Volume2` / `VolumeX` | Mutes/unmutes all remote audio output; red when muted |
| Camera | `TrackToggle` | LiveKit-managed; on/off |
| Background | `Layers` | Opens background effects menu; amber when active |
| Auto Cam | `Aperture` | Opens cam mode menu; blue when active |
| Reactions | `Smile` | Click to toggle emoji picker above bar; floating animations |
| Raise Hand | `Hand` | Broadcasts a raised-hand chip to all participants; green when active; click again to lower |
| Invite Link | `Link` | Opens share modal — copy `?room=ROOM_ID` link to share with anyone |
| Video Quality | `Film` + HD badge | Low 360p / Medium 720p / High 1080p dropdown |
| Screen Share | `Monitor` / `MonitorOff` | Opens pre-share menu; green when active; click again to stop |
| **Stop Sharing** | `MonitorOff` + label | Red pill — appears in controls bar **and** in the header when actively sharing |
| Leave | `PhoneOff` | Red; disconnects and returns to lobby |

#### Controls Bar — Mobile (≤ 640 px)
A **single horizontally scrollable row** at the bottom of the screen — all controls are always reachable by swiping; no hidden "More" panel. The scrollbar is hidden via `::-webkit-scrollbar { display: none }` and `scrollbarWidth: none`. Dropdown menus (Background, AutoCam, Quality, Share) render outside the overflow container (sibling divs in the bottom overlay) so they float upward without being clipped.

| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | Mute/unmute |
| Speaker | `Volume2` / `VolumeX` | Silence/restore remote audio; red when muted |
| Camera | `TrackToggle` | Camera on/off |
| Reactions | `Smile` | Toggle emoji panel above bar (amber when open) |
| Invite Link | `Link` | Copy room link / open InviteModal |
| Raise Hand | `Hand` | Raise hand; green when active |
| Background | `Layers` | Background effects menu (floats above bar) |
| Auto Cam | `Aperture` | Auto centre / 2-in-1 |
| Quality | `Film` + HD | Video quality selector |
| Screen Share | `Monitor` | Share screen |
| Chat | `MessageSquare` | Toggle chat sidebar (blue when open) |
| Leave | `PhoneOff` | Red; end call |

Button size: **40 px** on phones ≤ 430 px (`isSmallPhone`), **46 px** on wider mobile screens.

**Emoji panel** appears as an absolute chip above the scroll row; tapping any emoji sends it and closes the panel.

#### In-meeting Features
- 🎥 HD video conferencing via LiveKit (`GridLayout` + `ParticipantTile`)
- 🖱️ **Apple Dock magnification** (desktop) — hovering the controls bar magnifies icons with a Gaussian bell-curve wave; a two-pass cumulative X-shift pushes neighbours apart so gaps between icons are always preserved at any zoom level; spring-pop entry, fast cursor-tracking, and a micro-bounce settle on leave; `transform-origin: center` keeps click hit-areas aligned with visuals at all scales
- 😊 **Emoji reactions** — two modes triggered by the `Smile` button:
  - **Quick tap**: emoji floats up immediately (👍 ❤️ 😂 🎉 👏 🔥); visible to all participants via Supabase Realtime
  - **Long-press / right-click**: opens a composer popover anchored above the emoji — pre-filled with a smart editable sentence (`Sapho agrees.`, `Sapho loves this.` etc.); 50-char limit; Enter sends, Esc cancels, click-away closes; message broadcasts to all as a glassmorphism floating pill; 5 s rate-limit cooldown per sender
- ✋ **Raise hand** — `Hand` button broadcasts your name to all participants via Supabase Realtime (`hands:{roomId}`); raised hands appear as floating chips in the top-right of the video area showing ✋ + name; any participant can tap × to lower an individual hand, or "Lower all" to clear all at once; the broadcaster's own state stays in sync
- 🔇 **Speaker mute** — `Volume2` / `VolumeX` button silences all `<audio>` elements in the page (mutes remote audio output without affecting the microphone); red border when active
- 🎙️ **Background-noise suppression** — the mic is automatically run through LiveKit's Krisp noise-filter processor, which filters ambient/background noise and isolates the speaker's voice; applied to every mic track this participant publishes (including after toggling the mic off and back on, which creates a fresh track); the ~5–6 MB Krisp WASM/ML payload is **lazy-loaded** on first mic publish via dynamic `import()` — it never bloats the initial page load; silently skipped on unsupported browsers/platforms, so it never blocks the mic
- 🔗 Invite link — opens a share modal showing the plain `?room=ROOM_ID` link; anyone can copy and share it; recipients join directly with no account required
- 📽️ Video quality selector — Low (360p) / Medium (720p) / High (1080p)
- 🎨 Background Effects (`Layers` button, amber when active) — uses **MediaPipe Selfie Segmentation**; four modes:
  - **None** — restores original camera track
  - **Blur** — background blurred; intensity slider (2–20 px); Flip toggle
  - **Image** — upload any photo; cover-fitted as background; Flip toggle
  - **Virtual** — 8 procedurally drawn scene presets (Office, Beach, City, Forest, Mountains, Space, Sunset, Studio)
  - **Aspect-ratio-correct pipeline** — the output canvas is sized from the **real camera resolution** (preserving 16:9 / whatever the webcam reports, capped at 1280 px wide), so nothing is stretched or squashed. `replaceTrack` swaps the published LiveKit video track with `canvas.captureStream(30)`
  - **Clean blur** — the blurred layer is drawn with an overscan so the blur kernel's faded edges fall outside the frame, eliminating the dark-vignette rim a naive canvas blur produces
  - **High-contrast cutout** — MediaPipe's soft, semi-transparent mask edges are **thresholded into a crisp cutout** (with a thin anti-alias band, processed at ≤320 px for speed then upscaled), and a subtle dark rim shadow is composited around the attendee on Image/Virtual backgrounds — so the attendee stands out sharply instead of haloing/blending into the scene
- 📸 Auto Cam — floating window (bottom-right), two modes:
  - **Auto Centre** — follows the active speaker (1.5 s debounce); crosshair name tag
  - **2 in 1** — local (You) left, active speaker right; "Waiting…" when no remote speaker
- 🖥️ Screen sharing & presentation mode:
  - Pre-share menu: **Entire Screen** / **Select Window** (web also shows **Clear screen before sharing** toggle)
  - **Web — Entire Screen**: auto-enables clear-screen mode to avoid BeeHive echoing itself before capture; clears the flag after
  - **Web — Select Window**: standard browser screen-share picker
  - **Electron — Entire Screen**: uses `desktopCapturer` with `types: ['screen']` to grab the primary display directly — no OS dialog
  - **Electron — Select Window**: opens the `ElectronWindowPicker` modal; **single click** locks the selection (green border); **double-click** or the **Confirm** button shares immediately — moving the mouse does not deselect
  - Share menu: `position: fixed; bottom: 84px` centered with `maxHeight: calc(100vh - 120px)` — never overflows on 13" displays
  - Controls bar: `maxWidth: 96vw; flexWrap: wrap` — all buttons remain accessible on narrow screens (13" MacBook)
  - Active share bar: source label, **Add Window**, **Switch** (live `replaceTrack`), **Stop Sharing**
  - **Local share (presenter)**: main area shows live `<video>` preview of the shared stream — no mirror echo; fallback "Broadcasting…" shown while stream initialises
  - 🖥️ **Persistent sharing indicator** — always visible while sharing (top-left of the preview): "You're sharing your entire screen" / "You're sharing '<window title>'", plus elapsed sharing time and a quick **Stop** button
  - 🖱️ **Click-to-focus for window shares** (Electron desktop only) — clicking anywhere on the main-area preview brings the real shared window's owning app to the **foreground** instantly, via a native macOS window-activation call (`NSRunningApplication activateWithOptions:`) — **no input injection, no Accessibility permission required**:
    - The exact window is identified by its `CGWindowNumber`, parsed directly from the `desktopCapturer` source id Electron already resolved when the window was picked — no fuzzy title matching
    - BeeHive keeps running behind the activated window; switch back the normal way (Cmd-Tab, Dock, clicking BeeHive) — a subtle "Click to switch to this window" hint shows over the preview
    - Only applies to **window** shares — entire-screen sharing behaviour is untouched (there's no single window to activate)
    - Implemented by `electron/beehive-ctl.m`, a tiny one-shot native helper (compiled on demand in dev via `clang`, shipped via `extraResources` in packaged builds)
  - 🧊 **Floating Control Dock** (Electron desktop only, window shares) — since click-to-focus backgrounds BeeHive's main window, a separate **always-on-top** window keeps the core meeting controls reachable above whatever app is now in front:
    - Shows: mic mute/unmute, camera on/off, raise/lower hand, previous/next slide (when presenting Keynote/PowerPoint), chat (with unread-DM badge), participants (with live count), active-speaker name, a connection-quality dot, meeting + sharing elapsed timers, **Stop sharing**, and **Leave**
    - A **separate `BrowserWindow`** (`electron/dock.html`, plain HTML/JS, no React) — it cannot touch the LiveKit `Room` object directly, so actions are relayed through the main process to the main window's renderer (which owns the live connection) and state flows back the same way; state is pushed once per second while the dock is visible
    - Muting, raising a hand, or stopping the share act **without** stealing focus back to BeeHive, so the presenter can keep looking at the shared app; opening **Chat**, **Participants**, or clicking **Leave** brings BeeHive's main window forward first, since those need a visible UI
    - Positioned bottom-centre of the primary display, draggable, `skipTaskbar`, visible even over fullscreen apps (`setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })`)
    - Shown only while sharing a **window** (not entire-screen — no other app is in front to hide controls behind in that case)
  - **Remote share (viewer)**: takes full main area; cameras move to Participants window (auto-opens)
  - **Presentation overlay** — floats over the presentation on both web and desktop:
    - Controls bar, speaker video window, share bar, and Auto Cam all remain visible on top of the presentation
    - **Minimise (—)** button on the controls bar: collapses to a compact pill (mic · cam · stop share · expand · hide · leave); speaker window hides
    - **Hide (👁)** button: removes all controls from the screen; an amber **"Show controls"** pill appears at the bottom centre to restore
    - Controls auto-restore to full when sharing ends
- 🔳 **Fullscreen** (`Maximize2` / `Minimize2`, top-right of the main area) — expands the presentation/main area to fill the **entire screen** (web + desktop):
  - An overlay (`position: fixed; inset: 0`) makes the main area cover the header, chat sidebar, and participants window
  - Native OS fullscreen is also engaged — Electron via `setFullScreen()` IPC, web via the HTML5 Fullscreen API
  - **Esc**, the macOS green button, or the collapse button all exit; the exit button stays reachable even when controls are hidden
- 🪟 **Pop-out** (`ExternalLink`, top-right of the main area, **desktop only**) — detaches the shared presentation into its own separate, resizable window (Teams-style), so it can be dragged to a second monitor:
  - Works on **web** (`window.open`) and **desktop** (Electron `setWindowOpenHandler` spawns a native child window)
  - Available to the **viewer** (a remote presenter's share) **and** the **presenter** (their own share)
  - Auto-closes when sharing stops
- 🎯 **Laser pointer** (`Crosshair`, top-right of the main area, **desktop only**) — broadcasts your cursor position to everyone:
  - Toggle on, then move the mouse over the main area; all participants see a coloured, name-labelled pointer at that spot
  - Positions are sent over a Supabase Realtime broadcast channel (`cursors:{roomId}`), throttled to ~30 fps; cursor is removed for others when you leave the area or toggle off
- 🎚️ **Presenter slide control** (desktop only, while sharing) — the presenter can drive their **Keynote / PowerPoint** slideshow from the BeeHive main area or in fullscreen, without switching back to the presentation app:
  - On-screen **‹ ›** chevrons on the left/right edges of the main area, plus keyboard **← / →**, **Space**, **PageUp / PageDown**
  - Implemented with AppleScript (`osascript`) via an Electron IPC handler — no native key-injection module required; targets Keynote first, then PowerPoint
  - Requires macOS **Automation** permission (prompted on first use)
- 🔊 Speaking indicator (bottom-left):
  - Animated 5-bar equaliser chip with active speaker's first name
  - Floating speaker video window; **Minimise (—)** / **Close (✕)**; reappears for new speaker
  - `+N` badge when multiple participants speak simultaneously
- 📁 **File sharing** — drag any file onto the meeting area or use the paperclip button:
  - Amber dashed drop zone on drag-over
  - **Send to:** All participants or select individual attendees by name
  - Uploads to Supabase Storage (`shared-files` bucket, 50 MB limit); URL shared via Supabase Realtime
  - Targeted files render as download cards only for named recipients; "To: …" label on targeted shares
- 💬 Real-time chat sidebar (Supabase Realtime)
- 📴 Leave call — marks participant inactive in Supabase and broadcasts a **"[Name] left"** system event to the chat for all remaining attendees
- 👋 **Join / leave notifications** — horizontal-rule system messages in the chat sidebar: green **"[Name] joined"** on entry, grey **"[Name] left"** on exit; written to `chat_messages` with `display_name: '__SYSTEM__'`
- ⏱️ **Auto-end when alone** — if you are the only active participant for 10 minutes, a countdown warning banner appears at the top of the screen (`You're alone — call ends in Xs`); clicking **Stay** resets the timer; the call ends automatically when the countdown reaches zero
- 🔴 **Meeting ended state** — when the last participant leaves, `rooms.ended_at` is set and `rooms.is_active` is set to false; any subsequent visitor opening the invite link sees a "Meeting Ended" summary card (with end time) and a "Start a new meeting" button — the name input and join button are hidden, preventing re-join

### Participants Window
- Click the participant count pill in the header to open
- Draggable floating window — grab `⠿` title bar to reposition
- Drag toward the top → amber dock zone → **dock as horizontal strip** below the header
- Each tile: live video, name, mic status (green/red), cam status (green/red)
- Docked strip: scrollable thumbnails; **↙** undocks, **✕** closes

---

### Desktop App (Electron)

BeeHive ships as a native desktop app wrapping the same React frontend with an embedded Node.js backend.

**Desktop-specific window chrome:**
- **Draggable header + lobby** — both the in-meeting header and the lobby window have `-webkit-app-region: drag`; interactive children have `no-drag`
- **Traffic light clearance** — Electron builds use 88 px left padding in the header to clear macOS traffic lights; web builds use 18 px
- **Stop Sharing shortcut** — a green "Stop Sharing" button appears in the header when screen sharing is active, in addition to the red pill in the controls bar

**Extra capabilities vs. the web app:**

#### Drag-to-Present (Electron only)
Drag a presentation file (`.key`, `.keynote`, `.pptx`, `.ppt`, `.odp`, `.pdf`) onto the meeting area:

1. BeeHive detects the file extension and shows **"Open in Keynote / PowerPoint"**
2. Click — `shell.openPath()` launches the file in its native app
3. Modal changes to: *"Enter Presentation / Slideshow mode, then click Share Presentation"*
4. User starts the slideshow in Keynote / PowerPoint
5. Click **Share Presentation** — BeeHive calls `desktopCapturer.getSources()` and auto-matches the window by app name (Keynote, PowerPoint, Impress, Slides)
6. A **live thumbnail preview** of the detected window is shown with the amber border — *"This is what attendees will see"*
7. Click **Confirm & Share** → shares the window directly to all attendees, no OS dialog required
8. If no presentation window is detected, the window picker appears as a fallback ("Wrong window?" also opens it)

#### Drag-to-Share (both web and desktop)
Non-presentation files dropped on the meeting area go through the standard file share flow (Supabase Storage upload → download card in chat).

**Key Electron APIs used:**
- `shell.openPath(filePath)` — open file in native app; `File.path` (Electron-added property) gives the local path
- `desktopCapturer.getSources()` — enumerate windows/screens with base64 thumbnails (main process, exposed via IPC)
- `getUserMedia` with `chromeMediaSourceId` — capture a specific window without an OS dialog
- `beehive-ctl` (`electron/beehive-ctl.m`) — tiny one-shot native ObjC helper: given a `CGWindowNumber`, resolves the owning app's PID via `CGWindowListCopyWindowInfo` and brings it to the foreground via `NSRunningApplication activateWithOptions:`; invoked via `execFile`, no persistent process, no special permission required
- A second `BrowserWindow` (`electron/dock.html` + `dockPreload.cjs`) — the always-on-top Control Dock; `contextBridge.exposeInMainWorld('dockAPI', …)` exposes a separate, narrower bridge for that window
- `contextBridge.exposeInMainWorld('electronAPI', …)` — secure renderer bridge for the main window

**Running the desktop app (dev):**
```bash
npm run electron:dev
# Starts: backend (:3001) + Vite frontend (:5173) + Electron window
```

**Building a distributable:**
```bash
npm run electron:build:mac   # → release/BeeHive-1.0.0-arm64.dmg  (Apple Silicon)
npm run electron:build:win   # → release/*.exe (NSIS installer)
```

**Installing the built app (macOS):**
1. Open `release/BeeHive-1.0.0-arm64.dmg`
2. Drag BeeHive to Applications
3. First launch: right-click → Open (bypasses Gatekeeper — app is unsigned)
4. If multiple instances appear in the dock, quit all and relaunch once; the single-instance lock prevents duplicates from v1.0.0 onward

**API routing in packaged builds:**
In dev the Vite server proxies `/api/*` → `:3001`. In the packaged `.app` there is no Vite proxy — all `fetch` calls use `http://localhost:3001` directly (detected via `window.electronAPI`). The embedded backend still binds to `:3001` on launch.

**Invite links in the desktop app:**
The Electron app loads from `file://` so `window.location.href` would produce broken links like `file:///?room=...`. All invite link generation uses `VITE_WEB_BASE_URL` (set in `.env`) so copied links always point to the production web app (`https://beehive-fu8w.onrender.com?room=ROOM_ID`). Guests open the link in any browser — no desktop app required.

**Magic link deep-link (Electron):**
Supabase sends magic links with `emailRedirectTo: beehive://auth/confirm`. When clicked, macOS routes the URL to Electron via the registered `beehive://` URL scheme. `main.cjs` catches it via `open-url` (macOS) or `second-instance` argv (Windows), extracts the token hash, and loads `/?auth=confirm#<token>` in the renderer so Supabase's `detectSessionInUrl` processes it automatically.

---

### Fathom Integration

BeeHive connects to [Fathom](https://fathom.video) for AI meeting intelligence.

**Features (Lobby → "Recent meetings"):**
- Meeting list — title, date, duration, attendees
- AI-generated summary
- Action items with assignee and completion status
- On-demand transcript viewer
- "Open in Fathom ↗" deep-link
- Cursor-based pagination ("Load more")

**API:** `https://api.fathom.ai/external/v1` — proxied through Node.js backend (API key never reaches client).  
**Required env var:** `FATHOM_API_KEY`

---

### Security
- Row Level Security (RLS) on all Supabase tables
- Passwordless auth — no password storage, no brute-force surface
- Anon-safe participant tracking (no login required for `?room=` invite links)
- Fathom API key proxied through backend (never reaches client)
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `contextBridge` only
- `beehive://` deep-link handler validates token structure before loading into renderer

---

## Backend API Reference

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/livekit/token` | Generate LiveKit JWT; body: `{ roomName, displayName }` |
| `POST` | `/api/livekit/webhook` | LiveKit webhook receiver (`egress_ended`, `participant_left`) |
| `GET` | `/api/fathom/meetings` | Proxy to Fathom meetings list; query: `limit`, `cursor`, `created_after` |
| `GET` | `/api/fathom/recordings/:id/transcript` | Proxy to Fathom transcript for a recording |
| `GET` | `/health` | Health check — `{ status: 'ok' }` |

> File uploads go directly from the browser to **Supabase Storage** using the anon key — no backend route needed.

---

## Project Structure

```
beehive/
├── src/
│   └── main.tsx                        # React entry — wraps app in <AuthGate>
├── RoomPage.tsx                        # Root router (RoomPage) + MeetingRoom
├── components/                         # UI components & shared modules
│   ├── AuthGate.tsx                    #   auth wrapper; ?room= bypasses gate
│   ├── AuthScreen.tsx                  #   magic link + OTP sign-in / register UI
│   ├── InviteModal.tsx                 #   plain ?room=ROOM_ID link + copy button
│   ├── Lobby.tsx                       #   lobby (Start Now / Schedule + card-flip register)
│   ├── SchedulePanel.tsx               #   schedule + email-invite panel
│   ├── FathomPanel.tsx                 #   Fathom meetings + FathomMeetingRow
│   ├── ParticipantsWindow.tsx          #   draggable/dockable window + strip
│   ├── BackgroundMenu.tsx              #   background-effects menu
│   ├── AutoCamWindow.tsx               #   auto-cam floating window
│   ├── SpeakingIndicator.tsx           #   active-speaker chip + video (dual-window in presentation mode)
│   ├── ScreenShareMenu.tsx             #   pre-share menu
│   ├── ScreenShareBar.tsx              #   active-share bar
│   ├── ElectronWindowPicker.tsx        #   desktop window picker
│   ├── ReactionComposer.tsx            #   long-press emoji reaction composer popover
│   ├── DesktopHandoff.tsx              #   web → desktop sign-in handoff + OS-aware download link
│   ├── roomUtils.ts                    #   constants, helpers, drawVirtualScene
│   └── roomStyles.ts                   #   shared `s` styles object
├── livekit_react_hooks.tsx             # Hooks: useAuth, useProfile, useCreateRoom,
│                                       #   useJoinRoom, useRoomInfo, useParticipants,
│                                       #   useChat, useRecordings, useFathomMeetings,
│                                       #   useFathomTranscript
├── livekit_node_backend.js             # Express API: LiveKit token generation,
│                                       #   LiveKit webhook receiver, Fathom proxy
├── supabase/
│   └── migrations/
│       └── 001_auth_system.sql         # Auth schema additions (applied)
├── scripts/
│   └── seed-dev.js                     # Create 6 X Spark dev users via Supabase Admin API
├── electron/
│   ├── main.cjs                        # Electron main — beehive:// URL scheme + deep-link handler
│   ├── preload.cjs                     # contextBridge — exposes electronAPI
│   ├── beehive-ctl.m                   # native helper — activate a window by CGWindowNumber
│   ├── dock.html                       # Floating Control Dock UI (plain HTML/JS, separate window)
│   ├── dockPreload.cjs                 # contextBridge — exposes window.dockAPI to dock.html
│   └── entitlements.mac.plist          # macOS hardened runtime entitlements
├── assets/
│   └── icon.icns                       # macOS app icon
├── livekit_supabase_schema.sql         # Base Supabase schema
├── livekit_database_recommendation.md  # ADR: Supabase vs Firebase
├── index.html                          # App shell + Roboto font + --vh + zoom-to-fit
├── vite.config.ts                      # base: './' for Electron file:// compat
├── package.json                        # main: electron/main.cjs; build config
└── .env                                # Local secrets (git-ignored)
```

---

## Database Schema

**Base tables** ([`livekit_supabase_schema.sql`](./livekit_supabase_schema.sql)):

| Table | Purpose |
|-------|---------|
| `users` | Legacy user profiles (email, name, org); bridged to auth via `auth_user_id` |
| `rooms` | Meeting rooms with LiveKit room names |
| `room_participants` | Real-time participant tracking (anon-safe; `auth_user_id` set for authenticated users) |
| `chat_messages` | In-meeting chat + file share notifications |
| `recordings` | Recording metadata |
| `usage` | Billing/analytics tracking |
| `audit_logs` | Compliance + debugging (`auth_user_id` included) |

**Auth tables** ([`supabase/migrations/001_auth_system.sql`](./supabase/migrations/001_auth_system.sql)):

| Table | Purpose |
|-------|---------|
| `profiles` | Canonical post-auth identity (`id = auth.users.id`); `full_name`, `avatar_url`; auto-created on signup via trigger |
| `roles` | `admin` / `user` roles |
| `user_roles` | User ↔ Role junction; default `user` role assigned on signup |
| `invitations` | *(legacy)* Tokenised invitation schema — table still exists in the migration, but the app no longer reads/writes it; invites are now plain `?room=ROOM_ID` links (see [Invitations](#invitations)) |

---

## Architecture

```
React Frontend (Vite — default :5173)
        │
        ├── AuthGate → AuthScreen (magic link / OTP via Supabase Auth)
        │
        ├── Supabase (state, RLS, Realtime)
        │         └── PostgreSQL — rooms, participants, chat, recordings,
        │                          profiles, roles, user_roles
        │         └── Storage — shared-files bucket (file uploads)
        │
        └── /api/* → Node.js Backend (:3001)
                        ├── LiveKit Server SDK — token generation
                        │         └── LiveKit Cloud — media (WebRTC)
                        ├── LiveKit webhook receiver — recordings, participant-left
                        └── Fathom API proxy — meeting intelligence

Electron (desktop)
        ├── main.cjs — BrowserWindow + IPC handlers
        │         ├── shell.openPath()        — open presentation files natively
        │         ├── desktopCapturer         — enumerate windows for screen share
        │         └── beehive:// URL scheme   — intercept magic-link redirects
        └── preload.cjs — contextBridge → window.electronAPI
```

**Presentation share flow (Electron):**
1. Drop `.pptx` / `.key` → `shell.openPath(file.path)` launches app
2. User enters slideshow mode
3. Click "Share Presentation" → `desktopCapturer.getSources()` → keyword match
4. Thumbnail preview shown (amber border) → user confirms
5. `getUserMedia({ chromeMediaSourceId })` → `replaceTrack` on LiveKit screen share track

---

## Environment Variables

```env
# Fathom
FATHOM_API_KEY=your_fathom_api_key

# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Supabase (server-side — Node.js backend)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Supabase (client-side — Vite prefix required)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud

# App
VITE_WEB_BASE_URL=https://beehive-fu8w.onrender.com   # Used for invite link generation in Electron
PORT=3001

# Desktop app download links (optional — both default to the GitHub Releases
# page if unset; see "Download the desktop app" under Authentication)
VITE_DESKTOP_DOWNLOAD_MAC_URL=https://github.com/SaphoM/beehive/releases/latest
VITE_DESKTOP_DOWNLOAD_WIN_URL=https://github.com/SaphoM/beehive/releases/latest
```

**Supabase Dashboard settings required:**
- Authentication → URL Configuration → **Site URL**: `https://beehive-fu8w.onrender.com`
- Authentication → URL Configuration → **Redirect URLs**: `https://beehive-fu8w.onrender.com/**`, `http://localhost:5173/**`

**Seeding dev users (first-time setup):**
```bash
node scripts/seed-dev.js
# Creates 6 X Spark team accounts (email_confirm=true — no verification email)
# Promotes sapho@xspark.co.za to admin automatically
```

---

## Mobile Web Responsive Design

BeeHive's in-meeting UI is fully responsive for mobile browsers (iOS Safari, Android Chrome).

### Viewport Zoom-to-Fit

The page uses a **fixed 375 px design width** (iPhone SE / 13 mini — the smallest modern phone) and scales the viewport `initial-scale` on load so the layout fills any phone screen exactly, with nothing cut off:

```
375 px device  →  scale 1.00  (SE, 13 mini)
390 px device  →  scale 1.04  (iPhone 13, 14)
393 px device  →  scale 1.05  (iPhone 14 Pro, 15)
430 px device  →  scale 1.15  (iPhone 13/14 Pro Max)
```

Tablet and desktop (> 640 px) revert to `width=device-width, initial-scale=1.0`.

Implemented via a synchronous `<script>` in `index.html` (before React loads) that reads `window.screen.width` and sets the `<meta name="viewport">` content. Re-applied on `orientationchange`.

### iOS Safari Viewport Height (`--vh`)

iOS Safari's `100vh` includes the browser chrome (address bar + toolbar), so layout using `height: 100vh` would extend behind the UI. BeeHive sets a `--vh` CSS custom property equal to `window.innerHeight` (the real available height) on load, resize, and orientation change. All full-screen containers use `height: var(--vh, 100vh)` instead.

### Breakpoints

| Variable | Threshold | Used for |
|----------|-----------|---------|
| `isMobile` | `≤ 640 px` | Switch to mobile controls bar, compact header, floating timer |
| `isSmallPhone` | `≤ 430 px` | 40 px buttons, tighter gaps, count-only participant pill |

### Safe-Area Clearance

Controls bar bottom padding: `calc(env(safe-area-inset-bottom, 0px) + 72px)` — clears the home indicator (34 px on iPhone 13+) plus browser toolbar.

Speaking indicator bottom: `calc(env(safe-area-inset-bottom, 0px) + 130px)` — clears the controls bar.

### Mobile-Only / Desktop-Only Features

| Feature | Mobile | Desktop |
|---------|--------|---------|
| Laser pointer | Hidden (needs mouse cursor) | Visible |
| Pop-out presentation | Hidden (no multi-window on mobile) | Visible |
| Participant window popup | Hidden (main grid is primary view) | Clickable pill |
| Floating timer | Shown in video area | Shown in header |
| Chat / Stop Sharing | In `+` More panel | In header |

---

## Running Locally

**Web (two terminals):**
```bash
# Terminal 1
npm run dev:backend     # → BeeHive backend on :3001

# Terminal 2
npm run dev:frontend    # → http://localhost:5173
```

> **Port note:** BeeHive owns port **5173**. If another project also uses Vite on 5173, move that project's `.claude/launch.json` to a different port (e.g. 5174) to avoid conflicts.

**Desktop app:**
```bash
npm run electron:dev
# Starts backend + Vite + Electron window in one command (concurrently)
# Electron loads http://localhost:5173
```

---

## Branch Strategy

| Branch | Purpose | Merges into |
|--------|---------|-------------|
| `main` | Production | — |
| `staging` | Client / UAT testing | `main` |
| `develop` | Integration / internal testing | `staging` |
| `feature/*` | New features | `develop` |
| `bugfix/*` | Non-critical fixes | `develop` |
| `hotfix/*` | Emergency production fixes | `main` + `develop` |

---

## Supabase Project

- **Project:** X Spark LiveKit
- **Region:** eu-west-1
- **Dashboard:** [supabase.com](https://supabase.com) → X Spark org

---

## GitHub Repository

[github.com/SaphoM/beehive](https://github.com/SaphoM/beehive)

---

## Planned: Host Controls & Group Management

> Accessed from the Participants window. Only available to the room host / co-host role.

### Mute Controls

| Action | Scope | Description |
|--------|-------|-------------|
| Mute one | Individual | Host clicks a participant's mic icon to mute them |
| Mute all | Room-wide | Single action to mute every participant at once |
| Select + mute | Multi-select | Checkbox-select multiple attendees, then mute selection |

---

### Group System

Participants can be organised into named groups within a room.

**Labels:** Auto-assigned on join as `Group 1`, `Group 2`, `Group 3`, etc. Host can rename any group.

| Action | Description |
|--------|-------------|
| Assign to group | Drag participant tile onto a group, or use dropdown |
| Rename group | Click group label to edit inline |
| Mute group | Mutes all participants in that group |
| Break away discussion | Sends a group into a temporary sub-room |

---

### Breakaway Discussions

A **breakaway** moves a group into a temporary LiveKit sub-room, isolated from the main room.

**Flow:**
1. Host selects a group → **"Break Away"** button
2. Modal: choose duration (5 / 10 / 15 / 30 min, or custom) → confirm
3. Sub-room created (`{livekit_room_name}-group-{n}`) — participants auto-join
4. Countdown displayed in sub-room header
5. On expiry (or manual recall): participants rejoin main room

**Database impact:**
- New `breakaway_sessions` table: `room_id`, `group_id`, `livekit_sub_room`, `duration_minutes`, `started_at`, `ends_at`

---

## Roadmap

- [x] Authentication — Magic Link + Email OTP (no passwords); AuthGate; frictionless `?room=` join; post-meeting register CTA with card-flip animation
- [x] Invitation system — plain `?room=ROOM_ID` links, open to anyone, no account required; `InviteModal` in meeting controls (superseded the earlier tokenised-invitation backend, which has been removed)
- [x] User roles — `admin` / `user`; auto-assigned on signup; `is_admin()` RLS helper
- [x] Electron deep-link — `beehive://` URL scheme intercepts magic-link redirects
- [x] Web → desktop sign-in handoff — "Open in desktop app" button on the web lobby hands off the live session via `beehive://` (web-only, optional)
- [x] Desktop app download link — OS-aware "Download for macOS/Windows" fallback beneath the handoff button (excludes touch devices, incl. iPadOS); link target configurable via env, defaults to GitHub Releases
- [x] Background-noise suppression — Krisp noise filter on the mic (lazy-loaded, ~5–6 MB payload split into its own chunk so it never affects initial page load)
- [ ] Host role — host/co-host permissions
- [ ] Mute controls — individual, mute all, multi-select mute
- [ ] Group system — auto-labelled, renameable, group mute
- [ ] Breakaway discussions — timed sub-rooms with auto-recall
- [x] Screen sharing (Entire Screen / Select Window / Switch source / Clear screen mode / echo-free web share / Electron no-dialog capture)
- [x] Fullscreen — expand the main area to fill the entire screen (web + desktop)
- [x] Pop-out — detach the shared presentation into a separate window (web + desktop, viewer + presenter)
- [x] Laser pointer — broadcast your cursor to all participants over Supabase Realtime
- [x] Presenter slide control — drive Keynote / PowerPoint from the main area & fullscreen (macOS desktop, AppleScript)
- [x] Click-to-focus for window shares — click the preview to bring the shared window forward (native window activation, no injection); persistent "You're sharing" indicator with elapsed time + Stop
- [x] Floating always-on-top Control Dock — mic, camera, raise hand, slide nav, chat (unread badge), participants (count), stop sharing, leave, meeting/share timers, active-speaker name, connection-quality dot — visible above any foreground app while presenting a window
- [x] Meeting ended state — last-to-leave marks room ended; invite link shows summary card, blocks re-join
- [x] Join / leave notifications in chat
- [x] Auto-end when alone for 10 minutes (countdown banner with Stay option)
- [x] Speaking indicator + floating speaker video window (Minimise / Close)
- [ ] Recording playback UI
- [ ] DUT organisation SSO
- [ ] Syspro integration (government contracts)
- [x] Mobile web responsive — zoom-to-fit viewport, iOS safe-area, small-phone button sizing, no horizontal overflow (all modern iPhone sizes)
- [ ] Mobile native app (React Native + LiveKit mobile SDK)
- [x] Fathom integration — meeting summaries, action items, transcript viewer
- [x] Background effects — Blur / Image upload / Virtual scenes (MediaPipe segmentation); aspect-ratio-correct output (no stretch), overscan blur (no vignette), thresholded high-contrast attendee cutout with separating rim shadow
- [x] File sharing — drag-to-drop or paperclip; send to all or select attendees; Supabase Storage
- [x] Schedule meeting — date/time picker, email chip invites, shareable link, mailto integration
- [x] Electron desktop app — native file open, window capture without OS dialog, drag-to-present with preview confirmation
- [ ] Self-hosted LiveKit option (Africa-first / data sovereignty)
