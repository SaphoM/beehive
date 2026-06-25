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
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime subscriptions |
| Auth | Supabase Auth (anon + authenticated) |
| Icons | Lucide React |
| Fonts | Roboto (Google Fonts) — Thin (100) / Light (300) / Regular (400) |
| Backend | Node.js + Express 5 |
| Meeting Intelligence | Fathom API |
| Background AI | MediaPipe Selfie Segmentation |
| Desktop | Electron 42 + electron-builder |

---

## Features

### Lobby

- **BEE**HIVE wordmark — `BEE` in Roboto Regular (400), `HIVE` in Roboto Thin (100)
- **Start Now / Schedule** tab switcher:
  - **Start Now** — Meet / Sting mode toggle; enter name; start immediately
  - **Schedule** — pick date + time, add attendee emails as chips, generate an invite link, copy it or send pre-filled email invites via the system mail client; room is created in Supabase up front so the link works immediately
- Invite preview — guests visiting a `?room=ROOM_ID` link see the room name and live participant count before joining
- **Recent meetings** — expandable Fathom panel showing AI-summarised past meetings

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
| **BEE**HIVE wordmark | Smaller font (12 px, letterSpacing 2) |
| Participant count pill | Display only — tap does not open floating window; main grid is always the primary view |
| Leave | Compact red button; always visible |
| Chat, Stop Sharing | Hidden from header — Chat accessible via `+` More panel |
| **Meeting timer** | Floating pill overlaid at the top-centre of the video area (not in the header) |

#### Controls Bar — Desktop (left → right)
| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | LiveKit-managed; mute/unmute |
| Camera | `TrackToggle` | LiveKit-managed; on/off |
| Background | `Layers` | Opens background effects menu; amber when active |
| Auto Cam | `Aperture` | Opens cam mode menu; blue when active |
| Reactions | `Hand` | Click to toggle emoji picker above bar; floating animations |
| Invite Link | `Link` / `Link2Off` | Copies `?room=ROOM_ID`; icon changes on copy |
| Video Quality | `Film` + HD badge | Low 360p / Medium 720p / High 1080p dropdown |
| Screen Share | `Monitor` / `MonitorOff` | Opens pre-share menu; green when active; click again to stop |
| **Stop Sharing** | `MonitorOff` + label | Red pill — appears in controls bar **and** in the header when actively sharing |
| Leave | `PhoneOff` | Red; disconnects and returns to lobby |

#### Controls Bar — Mobile (≤ 640 px)
Two rows stack above each other; emoji panel floats above the More row.

**Primary row** (always visible, centered, full-width safe area):
| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | Mute/unmute |
| Camera | `TrackToggle` | Camera on/off |
| Reactions | `Hand` | Toggle emoji panel (amber when open) |
| Invite Link | `Link` | Copy room link |
| Leave | `PhoneOff` | Red; end call |
| More | `Plus` | Toggle the More row (grey when open) |

**More row** (appears above primary row when `+` tapped, spans full screen width):
| Control | Icon | Notes |
|---------|------|-------|
| Background | `Layers` | Background effects |
| Auto Cam | `Aperture` | Auto centre / 2-in-1 |
| Quality | `Film` + HD | Video quality selector |
| Screen Share | `Monitor` | Share screen (web picker) |
| Chat | `MessageSquare` | Toggle chat sidebar (blue when open) |
| Reactions | `Smile` | Toggle emoji panel above the More row (amber when open) |

**Emoji panel** appears above whichever row triggered it; tapping any emoji sends it and closes the panel.

#### In-meeting Features
- 🎥 HD video conferencing via LiveKit (`GridLayout` + `ParticipantTile`)
- 👋 Emoji reactions — floating animations (👍 ❤️ 😂 🎉 👏 🔥)
- 🔗 Invite link — copies `?room=ROOM_ID` URL to clipboard
- 📽️ Video quality selector — Low (360p) / Medium (720p) / High (1080p)
- 🎨 Background Effects (`Layers` button, amber when active) — uses **MediaPipe Selfie Segmentation**; four modes:
  - **None** — restores original camera track
  - **Blur** — background blurred; intensity slider (2–20 px); Flip toggle
  - **Image** — upload any photo; cover-fitted as background; Flip toggle
  - **Virtual** — 8 procedurally drawn scene presets (Office, Beach, City, Forest, Mountains, Space, Sunset, Studio)
  - Pipeline: `replaceTrack` swaps the published LiveKit video track with `640×480 canvas.captureStream(30)`
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
  - **Local share (presenter)**: main area shows live `<video>` preview of the shared stream with a pulsing **LIVE** badge — no mirror echo; fallback "Broadcasting…" shown while stream initialises
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
- 🪟 **Pop-out** (`ExternalLink`, top-right of the main area) — detaches the shared presentation into its own separate, resizable window (Teams-style), so it can be dragged to a second monitor:
  - Works on **web** (`window.open`) and **desktop** (Electron `setWindowOpenHandler` spawns a native child window)
  - Available to the **viewer** (a remote presenter's share) **and** the **presenter** (their own share)
  - Auto-closes when sharing stops
- 🎯 **Laser pointer** (`Crosshair`, top-right of the main area) — broadcasts your cursor position to everyone:
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
- `contextBridge.exposeInMainWorld('electronAPI', …)` — secure renderer bridge

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
- Anon-safe participant tracking (no login required for invite links)
- Fathom API key proxied through backend
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `contextBridge` only

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
│   └── main.tsx                        # React entry point
├── RoomPage.tsx                        # Root router (RoomPage) + MeetingRoom
├── components/                         # Extracted UI components & shared modules
│   ├── roomUtils.ts                    #   constants, helpers, drawVirtualScene
│   ├── roomStyles.ts                   #   shared `s` styles object
│   ├── Lobby.tsx                       #   lobby (Start Now / Schedule tabs)
│   ├── SchedulePanel.tsx               #   schedule + email-invite panel
│   ├── FathomPanel.tsx                 #   Fathom meetings + FathomMeetingRow
│   ├── ParticipantsWindow.tsx          #   draggable/dockable window + strip
│   ├── BackgroundMenu.tsx              #   background-effects menu
│   ├── AutoCamWindow.tsx               #   auto-cam floating window
│   ├── SpeakingIndicator.tsx           #   active-speaker chip + video
│   ├── ScreenShareMenu.tsx             #   pre-share menu
│   ├── ScreenShareBar.tsx              #   active-share bar
│   └── ElectronWindowPicker.tsx        #   desktop window picker
├── livekit_react_hooks.tsx             # Hooks: useCreateRoom, useJoinRoom,
│                                       #   useRoomInfo, useParticipants,
│                                       #   useChat, useRecordings,
│                                       #   useFathomMeetings, useFathomTranscript
├── livekit_node_backend.js             # Express API: token, webhooks, Fathom proxy
├── electron/
│   ├── main.cjs                        # Electron main process
│   ├── preload.cjs                     # contextBridge — exposes electronAPI
│   └── entitlements.mac.plist          # macOS hardened runtime entitlements
├── assets/
│   └── icon.icns                       # macOS app icon
├── livekit_supabase_schema.sql         # Full Supabase schema
├── livekit_database_recommendation.md  # ADR: Supabase vs Firebase
├── index.html                          # App shell + Roboto font
├── vite.config.ts                      # base: './' for Electron file:// compat
├── package.json                        # main: electron/main.cjs; build config
└── .env                                # Local secrets (git-ignored)
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | User profiles (email, name, org) |
| `rooms` | Meeting rooms with LiveKit room names |
| `room_participants` | Real-time participant tracking (anon-safe) |
| `chat_messages` | In-meeting chat + file share notifications |
| `recordings` | Recording metadata |
| `usage` | Billing/analytics tracking |
| `audit_logs` | Compliance + debugging |

Schema file: [`livekit_supabase_schema.sql`](./livekit_supabase_schema.sql)

---

## Architecture

```
React Frontend (Vite — default :5173)
        │
        ├── Supabase (state, RLS, Realtime)
        │         └── PostgreSQL — rooms, participants, chat, recordings
        │         └── Storage — shared-files bucket (file uploads)
        │
        └── /api/* → Node.js Backend (:3001)
                        ├── LiveKit Server SDK — token generation
                        │         └── LiveKit Cloud — media (WebRTC)
                        └── Fathom API proxy — meeting intelligence

Electron (desktop)
        ├── main.cjs — BrowserWindow + IPC handlers
        │         ├── shell.openPath()        — open presentation files natively
        │         └── desktopCapturer         — enumerate windows for screen share
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
PORT=3001
```

---

## Running Locally

**Web (two terminals):**
```bash
# Terminal 1
npm run dev:backend     # → BeeHive backend on :3001

# Terminal 2
npm run dev:frontend    # → http://localhost:5173
```

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

- [ ] Authentication (Supabase Auth email/password)
- [ ] Host role — host/co-host permissions
- [ ] Mute controls — individual, mute all, multi-select mute
- [ ] Group system — auto-labelled, renameable, group mute
- [ ] Breakaway discussions — timed sub-rooms with auto-recall
- [x] Screen sharing (Entire Screen / Select Window / Switch source / Clear screen mode / echo-free web share / Electron no-dialog capture)
- [x] Fullscreen — expand the main area to fill the entire screen (web + desktop)
- [x] Pop-out — detach the shared presentation into a separate window (web + desktop, viewer + presenter)
- [x] Laser pointer — broadcast your cursor to all participants over Supabase Realtime
- [x] Presenter slide control — drive Keynote / PowerPoint from the main area & fullscreen (macOS desktop, AppleScript)
- [x] Meeting ended state — last-to-leave marks room ended; invite link shows summary card, blocks re-join
- [x] Join / leave notifications in chat
- [x] Auto-end when alone for 10 minutes (countdown banner with Stay option)
- [x] Speaking indicator + floating speaker video window (Minimise / Close)
- [ ] Recording playback UI
- [ ] DUT organisation SSO
- [ ] Syspro integration (government contracts)
- [ ] Mobile (React Native + LiveKit mobile SDK)
- [x] Fathom integration — meeting summaries, action items, transcript viewer
- [x] Background effects — Blur / Image upload / Virtual scenes (MediaPipe segmentation)
- [x] File sharing — drag-to-drop or paperclip; send to all or select attendees; Supabase Storage
- [x] Schedule meeting — date/time picker, email chip invites, shareable link, mailto integration
- [x] Electron desktop app — native file open, window capture without OS dialog, drag-to-present with preview confirmation
- [ ] Self-hosted LiveKit option (Africa-first / data sovereignty)
