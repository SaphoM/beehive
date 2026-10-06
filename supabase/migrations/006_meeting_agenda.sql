-- ============================================================
-- 006_meeting_agenda.sql
-- BeeHive Bot Assistant — live, shared meeting agenda.
-- ============================================================
-- Deliberately a NEW table, separate from the existing scheduling-time
-- `beehive:prep:<roomId>` localStorage feature (SchedulePanel/MeetingPrep/
-- MeetingPrepWindow) — that feature is per-device and read-only in the room,
-- which is fine for its purpose but wrong for a *live, shared* agenda that
-- every participant needs to see the same, current state of, including
-- meetings that never had scheduling-time prep at all (Start Now).
--
-- One row per room, one JSONB column for the item list rather than a
-- separate items table — this is a small, single-owner-at-a-time editing
-- surface (host/co-host), not a high-write-concurrency structure, so a
-- single upsert-the-whole-blob write pattern (mirrors how RoomPage.tsx
-- already saves the local prep checklist) keeps this simple. `id` on each
-- item is a stable client-generated uuid so React keys / completed-state /
-- notes stay attached to the right item across reorders.
create table meeting_agendas (
  room_id uuid primary key references rooms(id) on delete cascade,
  title text not null default 'Meeting Agenda',
  organizer_name text,
  objectives text[] not null default '{}',
  -- items: [{ id: string, text: string, completed: boolean, notes: string, order: number }]
  items jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

alter table meeting_agendas enable row level security;

-- Anyone in the room can read the live agenda — matches every other
-- room-scoped realtime table in this app (chat_messages, room_participants,
-- admission_requests).
create policy "Anyone can read the meeting agenda"
  on meeting_agendas for select
  using (true);

-- No insert/update/delete policy for anon/authenticated at all, by design —
-- mirrors admission_requests/room_hosts. Writes only ever happen through
-- POST /api/rooms/:roomId/agenda (livekit_node_backend.js), which
-- authorizes the caller via the same isRoomModerator() check /admit and
-- /mute already use (hostSecret, or an already-admitted host/co-host role)
-- before touching this table with its service-role client. A client-side
-- edit surface existing in the UI is not itself a security boundary; this
-- table has none for anon/authenticated regardless of what the UI shows.

alter publication supabase_realtime add table meeting_agendas;
