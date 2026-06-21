# BEEHIVE
**X Spark Video Conferencing Platform**

> Real-time video meetings powered by LiveKit and Supabase.

---

## Overview

BeeHive is X Spark's video conferencing product. It supports two modes selectable from the lobby:

- **Meet** — standard video meetings
- **Sting** — alternative session mode

Built for scale: designed around the DUT (Durban University of Technology) use case of 50–200 concurrent users per lecture room.

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

---

## Features

### Lobby
- **BEE**HIVE wordmark — `BEE` in Roboto Regular (400), `HIVE` in Roboto Thin (100)
- Meet / Sting mode toggle (amber highlight on active)
- Invite preview — guests visiting a link see the room name and live participant count before joining

### In Meeting

#### Controls Bar (left → right)
| Control | Icon | Notes |
|---------|------|-------|
| Mic | `TrackToggle` | LiveKit-managed; mute/unmute |
| Camera | `TrackToggle` | LiveKit-managed; on/off |
| Reactions | `Hand` | Hover to reveal emoji picker; floating animations |
| Invite Link | `Link` / `Link2Off` | Copies `?room=ROOM_ID`; icon changes on copy |
| Video Quality | `Film` + HD badge | Low 360p / Medium 720p / High 1080p dropdown |
| Screen Share | `Monitor` / `MonitorOff` | Opens pre-share menu; green when active |
| Leave | `PhoneOff` | Red; disconnects and returns to lobby |

#### In-meeting Features
- 🎥 HD video conferencing via LiveKit (`GridLayout` + `ParticipantTile`)
- 👋 Emoji reactions — floating animations (👍 ❤️ 😂 🎉 👏 🔥)
- 🔗 Invite link — copies `?room=ROOM_ID` URL to clipboard
- 📽️ Video quality selector — Low (360p) / Medium (720p) / High (1080p)
- 🖥️ Screen sharing:
  - Pre-share menu: **Clear screen before sharing** toggle (fades BeeHive out before picker opens so the app doesn't appear in the capture preview), **Entire Screen**, **Select Window**
  - Active share bar: source label, **Add Window** (captures a second source), **Switch** (live `replaceTrack` between two sources), **Stop Sharing**
  - Local screen share track is excluded from the local `GridLayout` — prevents the infinite mirror echo
- 🔊 Speaking indicator (bottom-left, only visible when audio is active):
  - Animated 5-bar equaliser chip shows the active speaker's first name
  - Floating **speaker video window** appears above the chip with the active speaker's live camera feed
  - **Minimise (—)** collapses the video; a restore button appears in the chip
  - **Close (✕)** dismisses the window for that speaker identity; reappears automatically when a different speaker becomes active
  - `+N` badge on the chip when multiple participants speak simultaneously
- 💬 Real-time chat sidebar powered by Supabase Realtime
- 📴 Leave call (`PhoneOff` icon, red)

### Participants Window
- Click the **participant count pill** in the header to open
- Draggable floating window — grab the `⠿` title bar to reposition
- Drag toward the top of the screen → amber dock zone appears
- Release to **dock as a horizontal strip** below the header
- Each tile shows: live video (or camera-off placeholder), name, mic status (green/red), cam status (green/red)
- Docked strip: scrollable thumbnails; **↙** undocks, **✕** closes

### Security
- Row Level Security (RLS) on all Supabase tables
- Anon-safe participant tracking (no login required to join via invite link)

---

## Project Structure

```
beehive/
├── src/
│   └── main.tsx                        # React entry point
├── RoomPage.tsx                        # All UI components:
│                                       #   RoomPage (router)
│                                       #   Lobby
│                                       #   MeetingRoom
│                                       #   SpeakingIndicator
│                                       #   ScreenShareMenu
│                                       #   ScreenShareBar
│                                       #   ParticipantsWindow (draggable, dockable)
│                                       #   DockedParticipantsStrip
├── livekit_react_hooks.tsx             # Hooks: useCreateRoom, useJoinRoom,
│                                       #   useRoomInfo, useParticipants,
│                                       #   useChat, useRecordings
├── livekit_node_backend.js             # Express API: token generation + webhooks
├── livekit_supabase_schema.sql         # Full database schema (applied to Supabase)
├── livekit_database_recommendation.md  # Architecture decision record (Supabase vs Firebase)
├── index.html                          # App shell + Roboto font import
├── vite.config.ts                      # Vite config — /api proxied to :3001
├── package.json
└── .env                                # Local secrets (git-ignored)
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | User profiles (email, name, org) |
| `rooms` | Meeting rooms with LiveKit room names |
| `room_participants` | Real-time participant tracking (anon-safe) |
| `chat_messages` | In-meeting chat |
| `recordings` | Recording metadata |
| `usage` | Billing/analytics tracking |
| `audit_logs` | Compliance + debugging |

Schema file: [`livekit_supabase_schema.sql`](./livekit_supabase_schema.sql)

---

## Architecture

```
React Frontend (Vite — default :5173, may vary)
        │
        ├── Supabase (state, RLS, real-time subscriptions)
        │         └── PostgreSQL — rooms, participants, chat, recordings
        │
        └── /api/* → Node.js Backend (:3001)
                        └── LiveKit Server SDK — token generation
                                └── LiveKit Cloud — media (WebRTC)
```

**Join flow:**
1. User creates room → Supabase insert → gets `livekit_room_name`
2. Frontend calls `POST /api/livekit/token` → Node.js returns signed JWT
3. React connects to LiveKit Cloud with token
4. Participant list + chat sync via Supabase Realtime
5. On recording end → LiveKit webhook → recording metadata written to Supabase

**Invite flow:**
1. Host clicks 🔗 → `?room=ROOM_ID` copied to clipboard
2. Guest opens link → lobby fetches room name + participant count (`useRoomInfo`)
3. Guest enters name → joins with own LiveKit token

---

## Environment Variables

```env
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

**Terminal 1 — Backend:**
```bash
npm run dev:backend
# → BeeHive backend running on port 3001
```

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
# → http://localhost:5173 (or next available port)
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

**Feature workflow:**
```bash
git checkout develop
git checkout -b feature/your-feature
# ... build ...
git push origin feature/your-feature
# → open PR into develop
```

**Hotfix workflow:**
```bash
git checkout main
git checkout -b hotfix/critical-fix
# ... fix ...
git push origin hotfix/critical-fix
# → PR into main, then cherry-pick into develop
```

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

**UX flow:**
1. Open Participants window → hover a tile → mute icon appears
2. Or use the **"Mute All"** button in the window header
3. Or tick checkboxes on multiple tiles → **"Mute Selected"** action bar appears at the bottom

---

### Group System

Participants can be organised into named groups within a room.

**Labels:** Auto-assigned on join as `Group 1`, `Group 2`, `Group 3`, etc. Host can rename any group.

| Action | Description |
|--------|-------------|
| Assign to group | Drag participant tile onto a group, or use dropdown |
| Rename group | Click group label to edit inline |
| Mute group | Mutes all participants in that group |
| Break away discussion | Sends a group into a temporary sub-room for side discussion |

---

### Breakaway Discussions

A **breakaway** moves a group into a temporary LiveKit sub-room, isolated from the main room audio/video.

**Time option:** Host sets a duration (5 / 10 / 15 / 30 min, or custom). A countdown timer is visible to all participants in the sub-room. When time expires, participants are automatically returned to the main room.

**Flow:**
1. Host selects a group → **"Break Away"** button
2. Modal: choose duration → confirm
3. Sub-room created (`{livekit_room_name}-group-{n}`) — participants auto-join
4. Countdown displayed in sub-room header
5. On expiry (or manual recall): participants rejoin main room

**Database impact:**
- New `breakaway_sessions` table: `room_id`, `group_id`, `livekit_sub_room`, `duration_minutes`, `started_at`, `ends_at`
- Supabase Realtime fires recall event when `ends_at` is reached (via Edge Function cron)

---

## Roadmap

- [ ] Authentication (Supabase Auth email/password)
- [ ] Host role — host/co-host permissions
- [ ] Mute controls — individual, mute all, multi-select mute
- [ ] Group system — auto-labelled (Group 1/2/3), renameable, group mute
- [ ] Breakaway discussions — timed sub-rooms with auto-recall
- [x] Screen sharing (Entire Screen / Select Window / Switch source / Clear screen mode)
- [x] Speaking indicator + floating speaker video window (Minimise / Close)
- [ ] Recording playback UI
- [ ] DUT organisation SSO
- [ ] Syspro integration (government contracts)
- [ ] Mobile (React Native + LiveKit mobile SDK)
- [ ] Self-hosted LiveKit option (Africa-first / data sovereignty)
