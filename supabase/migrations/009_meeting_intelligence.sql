-- ============================================================
-- 009_meeting_intelligence.sql
-- Opt-in server-side meeting recording + AI notes pipeline.
-- See the "Enterprise Meeting Intelligence Bot" plan for full context.
-- ============================================================
-- Entirely additive: no existing table's columns, constraints, or RLS
-- policies are touched. Every new table follows the room_hosts precedent
-- (004_waiting_room.sql) — RLS enabled with ZERO client policies, reachable
-- only via the backend's service-role client, with REVOKE ALL as a
-- belt-and-braces guard against a future accidental permissive policy.

-- ------------------------------------------------------------
-- Per-room opt-in flags. No row for a room = feature entirely inactive for
-- it (today's default behavior, unchanged, for every existing room and for
-- Start Now rooms, which never get a row written at all in this feature).
-- ------------------------------------------------------------
CREATE TABLE room_intelligence_settings (
  room_id           uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  recording_enabled boolean NOT NULL DEFAULT false,
  ai_notes_enabled  boolean NOT NULL DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
ALTER TABLE room_intelligence_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE room_intelligence_settings FROM anon, authenticated;

-- ------------------------------------------------------------
-- The DB-backed "queue" — this deployment has no Redis/worker dyno, so job
-- state lives here: the webhook handler dispatches via setImmediate right
-- after inserting/updating a row, and a periodic sweep (meetingIntelligence.js)
-- retries anything stuck. Surviving a Render redeploy (which would kill a
-- pure in-memory queue) is the whole reason this is a table and not just a
-- variable.
-- ------------------------------------------------------------
CREATE TABLE meeting_intelligence_jobs (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id            uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  egress_id          text,                 -- LiveKit egress id, set when room_started starts recording
  status             text NOT NULL DEFAULT 'recording' CHECK (status IN (
                         'recording',           -- egress started, room still live
                         'egress_done',          -- room_finished stopped egress; audio object landed
                         'transcribing',
                         'transcribed',
                         'summarizing',
                         'complete',
                         'skipped_no_provider',  -- terminal, NOT an error — see providers/*.js
                         'failed'
                       )),
  attempts           int NOT NULL DEFAULT 0,
  last_error         text,
  audio_storage_path text,
  audio_url          text,
  transcript_id      uuid,                 -- FK added below, once meeting_transcripts exists
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
ALTER TABLE meeting_intelligence_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE meeting_intelligence_jobs FROM anon, authenticated;
CREATE INDEX idx_mi_jobs_room ON meeting_intelligence_jobs(room_id);
-- Sweep query shape: WHERE status NOT IN ('complete','failed') AND updated_at < now() - interval '...'
CREATE INDEX idx_mi_jobs_status_updated ON meeting_intelligence_jobs(status, updated_at);
-- egress_ended matches the job by egress_id (set at room_started) — must be
-- unique so that lookup is unambiguous. Nullable (not every row necessarily
-- reaches egress start before some future failure mode), so a plain UNIQUE
-- constraint (which allows multiple NULLs) is exactly right here.
CREATE UNIQUE INDEX idx_mi_jobs_egress_id ON meeting_intelligence_jobs(egress_id) WHERE egress_id IS NOT NULL;

CREATE TABLE meeting_transcripts (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id    uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  job_id     uuid NOT NULL REFERENCES meeting_intelligence_jobs(id) ON DELETE CASCADE,
  provider   text NOT NULL,       -- e.g. 'whisper', 'deepgram'
  full_text  text NOT NULL,
  segments   jsonb,               -- [{speaker?, start, end, text}] — provider-shaped; speaker
                                   -- omitted (never fabricated) where diarization isn't available
  created_at timestamptz DEFAULT now()
);
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE meeting_transcripts FROM anon, authenticated;

ALTER TABLE meeting_intelligence_jobs
  ADD CONSTRAINT fk_mi_jobs_transcript FOREIGN KEY (transcript_id)
  REFERENCES meeting_transcripts(id) ON DELETE SET NULL;

CREATE TABLE meeting_intelligence (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id          uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  job_id           uuid NOT NULL REFERENCES meeting_intelligence_jobs(id) ON DELETE CASCADE,
  provider         text NOT NULL,       -- e.g. 'openai', 'anthropic'
  summary_markdown text NOT NULL,       -- same lite-markdown subset FathomPanel already renders
  action_items     jsonb,               -- [{owner?, task, due_date?, priority?}]
  created_at       timestamptz DEFAULT now()
);
ALTER TABLE meeting_intelligence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE meeting_intelligence FROM anon, authenticated;
CREATE INDEX idx_mi_room ON meeting_intelligence(room_id);

-- ------------------------------------------------------------
-- Private bucket for raw egress audio. NOT public (unlike 005_avatars_bucket
-- .sql) — meeting audio is sensitive. Zero storage.objects policies: only
-- the backend's service-role client and LiveKit Egress's own S3 credentials
-- (external to Supabase's policy engine entirely) can ever write here.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('meeting-intelligence', 'meeting-intelligence', false)
ON CONFLICT (id) DO NOTHING;
