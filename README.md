# BEEHIVE
**X Spark Video Conferencing Platform**

> Real-time video meetings powered by LiveKit and Supabase.

---

## Overview

BeeHive is X Spark's internal video conferencing product. It supports two modes:
- **Meet** — standard video meetings
- **Sting** — alternative mode (selectable on the lobby screen)

Built for scale: designed around the DUT (Durban University of Technology) use case of 50–200 concurrent users per lecture room.

---

## Screenshot

![BeeHive in session](./docs/screenshot.png)

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite |
| Video/Audio | LiveKit Cloud |
| Database | Supabase (PostgreSQL) |
| Real-time | Supabase Realtime subscriptions |
| Auth | Supabase Auth (anon + authenticated) |
| Icons | Lucide React |
| Fonts | Roboto (Google Fonts) |
| Backend | Node.js + Express |

---

## Features

- 🎥 HD video conferencing via LiveKit
- 🎤 Mic + camera toggles
- 👋 Emoji reactions (👍 ❤️ 😂 🎉 👏 🔥)
- 🔗 One-click invite link (copies `?room=ROOM_ID` to clipboard)
- 📽️ Video quality selector (Low / Medium / High)
- 💬 Real-time chat sidebar (Supabase Realtime)
- 📴 Leave call with PhoneOff icon
- 🔒 Row Level Security (RLS) on all Supabase tables
- 👁️ Invite preview — guests see room name + participant count before joining
- 👥 Participants window — click the participant count pill to open a video grid of all participants with mic/cam status indicators
  - Draggable floating window (grab the title bar to reposition)
  - Drag to the top of the screen to dock as a compact horizontal strip below the header
  - Undock (↙) restores the floating window; close (✕) dismisses entirely

---

## Project Structure

```
beehive/
├── src/
│   └── main.tsx                    # React entry point
├── RoomPage.tsx                    # Main UI — lobby + meeting room
├── livekit_react_hooks.tsx         # Supabase + LiveKit hooks
├── livekit_node_backend.js         # Express API — token generation + webhooks
├── livekit_supabase_schema.sql     # Full database schema
├── livekit_database_recommendation.md  # Architecture decision record
├── index.html                      # App shell + Roboto font import
├── vite.config.ts                  # Vite config with /api proxy to :3001
├── package.json
└── .env                            # Local secrets (git-ignored)
```

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | User profiles (email, name, org) |
| `rooms` | Meeting rooms with LiveKit room names |
| `room_participants` | Real-time participant tracking |
| `chat_messages` | In-meeting chat |
| `recordings` | Recording metadata |
| `usage` | Billing/analytics tracking |
| `audit_logs` | Compliance + debugging |

Schema file: [`livekit_supabase_schema.sql`](./livekit_supabase_schema.sql)

---

## Architecture

```
React Frontend (Vite :5173)
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
2. Frontend calls `/api/livekit/token` → Node.js generates signed JWT
3. React connects to LiveKit Cloud with token
4. Participant list + chat sync via Supabase Realtime
5. Recording metadata written via webhook on session end

---

## Environment Variables

Create a `.env` file in the project root:

```env
# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_api_key
LIVEKIT_API_SECRET=your_api_secret

# Supabase (server-side)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Supabase (client-side)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_LIVEKIT_URL=wss://your-project.livekit.cloud

# App
PORT=3001
```

---

## Running Locally

**Terminal 1 — Backend (token generation):**
```bash
npm run dev:backend
# → BeeHive backend running on port 3001
```

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
# → http://localhost:5173
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

## Roadmap

- [ ] Authentication (Supabase Auth email/password)
- [ ] Screen sharing
- [ ] Recording playback UI
- [ ] DUT organisation SSO
- [ ] Syspro integration (government contracts)
- [ ] Mobile (React Native + LiveKit mobile SDK)
- [ ] Self-hosted LiveKit option (Africa-first / data sovereignty)
