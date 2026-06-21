-- ============================================================
-- LiveKit + Supabase Schema
-- X Spark | Video Conferencing Backend
-- ============================================================

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS
-- ============================================================
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  name text not null,
  organisation text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table users enable row level security;

create policy "Users can read own record"
  on users for select
  using (auth.uid() = id);

create policy "Users can update own record"
  on users for update
  using (auth.uid() = id);

-- ============================================================
-- ROOMS
-- ============================================================
create table if not exists rooms (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  livekit_room_name text unique not null,
  created_by uuid references users(id) on delete set null,
  organisation text,
  is_active boolean default true,
  max_participants int default 200,
  created_at timestamptz default now(),
  ended_at timestamptz
);

alter table rooms enable row level security;

create policy "Room members can view rooms"
  on rooms for select
  using (
    exists (
      select 1 from room_participants
      where room_participants.room_id = rooms.id
      and room_participants.user_id = auth.uid()
    )
    or created_by = auth.uid()
  );

create policy "Authenticated users can create rooms"
  on rooms for insert
  with check (auth.role() = 'authenticated');

create policy "Room creator can update room"
  on rooms for update
  using (created_by = auth.uid());

-- ============================================================
-- ROOM PARTICIPANTS
-- ============================================================
create table if not exists room_participants (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  display_name text,
  joined_at timestamptz default now(),
  left_at timestamptz,
  is_active boolean default true,
  role text default 'participant' check (role in ('host', 'co-host', 'participant')),
  unique(room_id, user_id)
);

alter table room_participants enable row level security;

create policy "Participants can view others in same room"
  on room_participants for select
  using (
    exists (
      select 1 from room_participants rp
      where rp.room_id = room_participants.room_id
      and rp.user_id = auth.uid()
    )
  );

create policy "Users can join rooms"
  on room_participants for insert
  with check (auth.uid() = user_id);

create policy "Users can update own participant record"
  on room_participants for update
  using (auth.uid() = user_id);

-- ============================================================
-- CHAT MESSAGES
-- ============================================================
create table if not exists chat_messages (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  display_name text,
  message text not null,
  created_at timestamptz default now()
);

alter table chat_messages enable row level security;

create policy "Room members can read chat"
  on chat_messages for select
  using (
    exists (
      select 1 from room_participants
      where room_participants.room_id = chat_messages.room_id
      and room_participants.user_id = auth.uid()
    )
  );

create policy "Room members can send messages"
  on chat_messages for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from room_participants
      where room_participants.room_id = chat_messages.room_id
      and room_participants.user_id = auth.uid()
      and room_participants.is_active = true
    )
  );

-- ============================================================
-- RECORDINGS
-- ============================================================
create table if not exists recordings (
  id uuid primary key default uuid_generate_v4(),
  room_id uuid references rooms(id) on delete cascade,
  file_url text,
  storage_path text,
  duration_seconds int,
  file_size_bytes bigint,
  status text default 'processing' check (status in ('processing', 'ready', 'failed')),
  created_at timestamptz default now(),
  completed_at timestamptz
);

alter table recordings enable row level security;

create policy "Room members can view recordings"
  on recordings for select
  using (
    exists (
      select 1 from room_participants
      where room_participants.room_id = recordings.room_id
      and room_participants.user_id = auth.uid()
    )
  );

-- ============================================================
-- USAGE TRACKING
-- ============================================================
create table if not exists usage (
  id uuid primary key default uuid_generate_v4(),
  organisation text,
  room_id uuid references rooms(id) on delete set null,
  participant_count int,
  duration_minutes int,
  recorded boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  resource text,
  resource_id uuid,
  metadata jsonb,
  created_at timestamptz default now()
);

-- ============================================================
-- REAL-TIME: enable for live participant + chat updates
-- ============================================================
alter publication supabase_realtime add table room_participants;
alter publication supabase_realtime add table chat_messages;
