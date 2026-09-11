-- ============================================================
-- 004_waiting_room.sql
-- Waiting room + host-delegated admit rights, scheduled meetings only.
-- See the "Waiting Room + Host-Delegated Admit Rights" plan for full context.
-- ============================================================

-- Explicit flag distinguishing gated scheduled meetings from instant Start
-- Now rooms — RoomPage.tsx's join path is shared by both, so the gate needs
-- an explicit per-room signal rather than something inferred from how the
-- room was created. Defaults false: no existing room is retroactively gated.
ALTER TABLE rooms ADD COLUMN requires_admission boolean NOT NULL DEFAULT false;

-- Host identity secret — deliberately NOT a column on the already-publicly-
-- SELECT-able `rooms` row ("Anyone can view rooms" USING (true) — a secret
-- there would be trivially readable by any guest with the invite link).
-- RLS enabled with ZERO policies: completely inaccessible to anon/
-- authenticated, reachable only via the backend's service-role client.
CREATE TABLE room_hosts (
  room_id uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  host_secret text NOT NULL
);
ALTER TABLE room_hosts ENABLE ROW LEVEL SECURITY;
-- Belt-and-braces per the usage/audit_logs precedent earlier this project:
-- RLS-with-no-policy already denies anon/authenticated regardless of table
-- grants, but Supabase's default full CRUD grants would still be the only
-- thing standing between a future accidental permissive policy and every
-- host secret in the database. Revoke them so RLS isn't the sole barrier.
REVOKE ALL ON TABLE room_hosts FROM anon, authenticated;

-- Admission requests — its own table, not a column on room_participants:
-- that table already has a fully permissive "Anyone can update participants"
-- UPDATE policy (USING (true), pre-existing, supports other legitimate
-- client-side updates like is_active/left_at and is out of scope to tighten
-- here). Adding admission state directly there would let any attendee
-- self-admit with one anon-key REST call. SELECT/INSERT stay permissive
-- (both the waiting attendee and the host/co-hosts need to read live status
-- via Realtime, and anyone should be able to request to join) but there is
-- NO UPDATE policy for anon/authenticated at all — status only ever changes
-- via the backend's service-role client.
CREATE TABLE admission_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  identity text NOT NULL,             -- the per-connection UUID from useJoinRoom
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','admitted','denied')),
  requested_at timestamptz DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (room_id, identity) -- lets the token endpoint upsert idempotently on repeat/reconnect requests
);
ALTER TABLE admission_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can request admission" ON admission_requests
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can read admission status" ON admission_requests
  FOR SELECT USING (true);
-- No UPDATE policy — deliberate; see comment above.

ALTER PUBLICATION supabase_realtime ADD TABLE admission_requests;
