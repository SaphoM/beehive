-- ============================================================
-- 010_personal_meeting_notes.sql
-- Per-participant AI Note Taker ownership.
-- ============================================================
-- Problem being fixed: meeting_intelligence (009) stores ONE summary per
-- room/job — every participant who can see a room's notes at all sees the
-- exact same shared row. There is no per-participant enable/disable, no
-- per-participant ownership, and no way for one participant to start/stop
-- their own AI Note Taker without it being a room-wide toggle.
--
-- This migration does NOT touch the shared recording/transcription
-- machinery (room_intelligence_settings, meeting_intelligence_jobs,
-- meeting_transcripts) — capturing and transcribing the meeting's actual
-- audio genuinely is a shared, room-level resource (one physical LiveKit
-- Egress per meeting; every participant already hears the same audio in
-- real time, so the raw transcript is not "someone else's private data").
-- What was wrong is *ownership of the generated notes*, not the audio
-- pipeline — so only that layer changes here, additively.
--
-- meeting_intelligence (the old shared-summary table) is left completely
-- untouched — schema and any existing rows stay exactly as they are. The
-- backend simply stops writing new rows there (see meetingIntelligence.js)
-- in favor of this table; nothing reads meeting_intelligence going forward,
-- but nothing that already depended on the table's existence breaks either.
CREATE TABLE personal_meeting_notes (
  id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id              uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  -- LiveKit's per-connection identity (a random UUID the client already
  -- generates and sends to /api/livekit/token — see livekit_react_hooks.tsx
  -- useJoinRoom). Stable for the lifetime of one connection, unique per
  -- participant *session* (not per person across reconnects) — exactly the
  -- granularity "one participant's one AI Note Taker session" needs.
  participant_identity text NOT NULL,
  display_name         text,
  -- Proves ownership on stop/restart/retrieve for participants who aren't
  -- signed in (the majority of BeeHive's frictionless guest joins) — the
  -- same role host_secret already plays for anonymous room hosts
  -- (004_waiting_room.sql). participant_identity itself is NOT a secret: it
  -- is visible to every other participant via LiveKit's own room roster, so
  -- it must never be usable on its own to read or control this session.
  session_secret       text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  -- Set when the participant is signed in, resolved server-side from their
  -- verified accessToken (never trusted from the client directly) — lets
  -- /api/me/meeting-notes show a signed-in user their own notes without
  -- needing their session_secret, mirroring how organizer/invitee access
  -- already works for the room itself.
  owner_user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  summary_markdown      text,
  action_items          jsonb,
  -- Why this specific participant's note generation failed, if it did —
  -- independent of any other participant's outcome, and independent of the
  -- shared job's own last_error (which is about recording/transcription,
  -- not this per-participant stage). Never silently blank on failure.
  last_error            text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
ALTER TABLE personal_meeting_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE personal_meeting_notes FROM anon, authenticated;

-- One active-or-stopped row per (room, participant connection) — starting
-- twice for the same identity must find the existing row, not create a
-- second, conflicting session (see the /personal-notes/start endpoint's
-- 409-on-already-active handling).
CREATE UNIQUE INDEX idx_personal_notes_room_identity ON personal_meeting_notes(room_id, participant_identity);
CREATE INDEX idx_personal_notes_owner ON personal_meeting_notes(owner_user_id) WHERE owner_user_id IS NOT NULL;
