# LiveKit Project: Database Recommendation
**X Spark | Video Conferencing Backend**

## Recommendation: Use Supabase

---

## Why Supabase Wins

**1. Access Control**
- RLS policies handle "only room members see that room's messages/participants" automatically
- No need to build auth logic in Node.js

**2. Cost at Scale**
- You don't want per-read billing when 100 people are in a room
- Supabase: flat $5-25/month regardless of concurrent users
- Firebase: per-read/write billing gets expensive fast

**3. Scalability**
- PostgreSQL handles concurrent users better than Firestore
- Real-time subscriptions work reliably with high participant counts
- University use case (DUT): expect 50-200 concurrent users during lectures

**4. Integration Ready**
- Can run Django or Node.js service alongside Supabase
- Not locked into Google Cloud

**5. Open Source Philosophy**
- Aligns with French government's approach (La Suite Meet)
- Aligns with Africa-first positioning (avoid US-only vendor lock-in)
- Can self-host PostgreSQL on your own servers if needed

---

## Firebase: When It Would Make Sense
- < 20 concurrent users per room maximum
- Fastest possible launch (48 hours to MVP)
- No plans for backend services

**Reality check:** For DUT (university), you'll hit 100+ concurrent users during lectures. Firebase costs explode at that scale.

---

## The Math: Firebase vs Supabase at DUT Scale

**Assumptions:**
- 50 video rooms per day
- Average 30 participants per room
- 50% of meetings are recorded
- Chat is moderate (5 messages/participant)

**Firebase Firestore Cost**

A single user joining a room triggers cascade reads:
1. Read the room (1 read)
2. Read all participants (30 reads)
3. Read chat history (M reads)
4. Read recordings (O reads)

Estimated: **$40-80/month** at DUT scale

**Supabase Cost**

| Item | Cost |
|------|------|
| Database storage (~50 MB) | FREE |
| Recording storage (37.5 GB/month on S3) | ~$1-2 |
| Supabase tier | $5-25/month |
| **Total** | **$6-27/month flat** |

**At DUT scale, Supabase is 5-10x cheaper.**

---

## Architecture

```
React Frontend
      ↓
Supabase (state, RLS, real-time)
      ↓
Node.js Backend (token generation)
      ↓
LiveKit Server (media)
```

**Flow:**
1. User creates room → Supabase insert
2. Get `livekit_room_name` from Supabase
3. Request access token from Node.js backend
4. Node.js backend creates token using LiveKit SDK
5. React connects to LiveKit with token
6. Real-time participant list updates via Supabase subscriptions
7. Chat messages stored/synced via Supabase
8. Recording metadata stored after session ends

---

## Key Schema Tables

| Table | Purpose |
|-------|---------|
| `users` | Email, name, org |
| `rooms` | Meeting with LiveKit room name |
| `room_participants` | Real-time participant list |
| `recordings` | Metadata for recorded sessions |
| `chat_messages` | Real-time chat |
| `usage` | Tracking for billing/analytics |
| `audit_logs` | Compliance + debugging |

See `livekit_supabase_schema.sql` for the full schema.

---

## Next Steps

1. Create Supabase project (5 min)
2. Apply the schema (`livekit_supabase_schema.sql`)
3. Build React hooks for:
   - Room creation
   - Participant list (real-time)
   - Chat (real-time)
   - Recording uploads
4. Create Node.js backend for:
   - LiveKit token generation
   - Webhook handlers

**Timeline: 2-3 weeks to MVP**

---

## Related Files

- `livekit_supabase_schema.sql` — Full schema to deploy
- `livekit_react_hooks.tsx` — React hooks for Supabase + LiveKit
- `livekit_node_backend.js` — Backend for token generation
