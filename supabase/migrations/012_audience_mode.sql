-- ============================================================
-- 012_audience_mode.sql
-- Large sessions: attendees join as audience, hosts promote speakers.
-- ============================================================
-- Opt-in per scheduled room. When set, the token endpoint issues attendees
-- a grant WITHOUT publish rights (mic / camera / screen) but WITH data
-- rights (chat, reactions, raised hands), and hosts / co-hosts promote one
-- person at a time to 'speaker'. Start Now rooms and every existing room
-- default to false and behave exactly as before.
alter table rooms add column if not exists audience_mode boolean not null default false;

-- Two new participant roles. 'attendee' is the audience default in an
-- audience-mode room; 'speaker' is an attendee a host has promoted. Both
-- are recorded here so a reconnecting participant's token reflects their
-- current standing (see /api/livekit/token), and pushed live to LiveKit
-- as the participant's attribute + publish permission (see /speaker).
alter table room_participants drop constraint if exists room_participants_role_check;
alter table room_participants
  add constraint room_participants_role_check
  check (role in ('host', 'co-host', 'participant', 'speaker', 'attendee'));
