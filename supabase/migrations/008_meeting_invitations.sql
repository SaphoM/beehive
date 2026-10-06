-- Add scheduling metadata to the rooms table so the host's own carousel can
-- show date/time/duration without a separate lookup.
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS scheduled_date text,
  ADD COLUMN IF NOT EXISTS scheduled_time text,
  ADD COLUMN IF NOT EXISTS duration_minutes int;

-- Per-invitee RSVP records. Deliberately its own table (not a column on
-- room_participants or rooms) so the SELECT policy here doesn't have to give
-- every participant read access to every other participant's RSVP state —
-- invitees only ever see their own row. Writes only happen through the
-- service-role backend (/api/rooms/:roomId/invitations and
-- /api/invitations/:id), so there is no INSERT or UPDATE policy for client
-- callers — preventing anyone from self-inviting or self-admitting.
CREATE TABLE IF NOT EXISTS meeting_invitations (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id          uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  invitee_email    text NOT NULL,
  invitee_user_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'tentative')),
  invited_by_name  text NOT NULL DEFAULT '',
  invited_at       timestamptz DEFAULT now(),
  responded_at     timestamptz,
  UNIQUE (room_id, invitee_email)
);

ALTER TABLE meeting_invitations ENABLE ROW LEVEL SECURITY;

-- Invitees can read their own row; organizers can read all rows for their rooms.
-- No INSERT/UPDATE policy — writes go through the service-role backend only.
CREATE POLICY "invitee or organizer can read" ON meeting_invitations
  FOR SELECT USING (
    invitee_email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM rooms r
      WHERE r.id = room_id
        AND r.scheduler_auth_user_id = auth.uid()
    )
  );

-- Realtime so the carousel reacts instantly when invitations change.
ALTER PUBLICATION supabase_realtime ADD TABLE meeting_invitations;
