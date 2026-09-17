-- ============================================================
-- 001_auth_system.sql
-- Adds profiles, roles, user_roles, invitations tables.
-- Bridges existing users table to auth.users via auth_user_id.
-- Loosens RLS on rooms/participants/chat for frictionless ?room= join.
-- ============================================================

-- -----------------------------------------------------------------------
-- 1. Extend existing tables with auth bridges
-- -----------------------------------------------------------------------

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id) UNIQUE;

CREATE INDEX IF NOT EXISTS users_auth_user_id_idx ON users(auth_user_id);

ALTER TABLE room_participants
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);

-- -----------------------------------------------------------------------
-- 2. Profiles (canonical post-auth identity, id = auth.users.id)
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- -----------------------------------------------------------------------
-- 3. Roles
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL CHECK (name IN ('admin', 'user')),
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO roles (name, description) VALUES
  ('admin', 'Full administrative access'),
  ('user',  'Standard authenticated user')
ON CONFLICT (name) DO NOTHING;

-- -----------------------------------------------------------------------
-- 4. User ↔ Role junction
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id     UUID NOT NULL REFERENCES roles(id)      ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role_id)
);

-- -----------------------------------------------------------------------
-- 5. Invitations
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invitations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token         TEXT UNIQUE NOT NULL,
  invited_by    UUID NOT NULL REFERENCES auth.users(id),
  invited_email TEXT NOT NULL,
  room_id       UUID REFERENCES rooms(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  used_at       TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS invitations_token_idx  ON invitations(token);
CREATE INDEX IF NOT EXISTS invitations_email_idx  ON invitations(invited_email);
CREATE INDEX IF NOT EXISTS invitations_status_idx ON invitations(status);

-- -----------------------------------------------------------------------
-- 6. Trigger: auto-create profile + default 'user' role on signup
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO profiles (id, full_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      INITCAP(split_part(NEW.email, '@', 1))
    )
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO user_roles (user_id, role_id)
  SELECT NEW.id, r.id FROM roles r WHERE r.name = 'user'
  ON CONFLICT (user_id, role_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- -----------------------------------------------------------------------
-- 7. profiles.updated_at auto-stamp
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- -----------------------------------------------------------------------
-- 8. Helper: is the current JWT holder an admin?
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = auth.uid() AND r.name = 'admin'
  );
$$;

-- -----------------------------------------------------------------------
-- 9. RLS for new tables
-- -----------------------------------------------------------------------

ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- profiles: read own or admin reads all; update own only
CREATE POLICY "profiles_select"     ON profiles FOR SELECT TO authenticated USING  (auth.uid() = id OR is_admin());
CREATE POLICY "profiles_insert_own" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated USING  (auth.uid() = id);

-- roles: read-only by any authenticated user
CREATE POLICY "roles_select" ON roles FOR SELECT TO authenticated USING (true);

-- user_roles: own row or admin
CREATE POLICY "user_roles_select"       ON user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id OR is_admin());
CREATE POLICY "user_roles_admin_manage" ON user_roles FOR ALL    TO authenticated USING (is_admin());

-- invitations: creator or admin can read/update; anyone authenticated can create
CREATE POLICY "invitations_insert" ON invitations FOR INSERT TO authenticated WITH CHECK (auth.uid() = invited_by);
CREATE POLICY "invitations_select" ON invitations FOR SELECT TO authenticated USING  (auth.uid() = invited_by OR is_admin());
CREATE POLICY "invitations_update" ON invitations FOR UPDATE TO authenticated USING  (auth.uid() = invited_by OR is_admin());

-- -----------------------------------------------------------------------
-- 10. Loosen room/participant/chat RLS for frictionless ?room= join
--     (lobby/creation still requires auth; joining does not)
-- -----------------------------------------------------------------------

-- Any UUID-holder can read room info (needed for invite preview before joining)
DROP POLICY IF EXISTS "Room members can view rooms" ON rooms;
CREATE POLICY "rooms_select" ON rooms FOR SELECT USING (true);

-- Anyone can join a room via link (frictionless)
DROP POLICY IF EXISTS "Users can join rooms" ON room_participants;
CREATE POLICY "room_participants_insert" ON room_participants FOR INSERT WITH CHECK (true);

-- Anyone can see who is in a room
DROP POLICY IF EXISTS "Participants can view others in same room" ON room_participants;
CREATE POLICY "room_participants_select" ON room_participants FOR SELECT USING (true);

-- Update own record: auth users match by auth_user_id; anon rows always updatable
DROP POLICY IF EXISTS "Users can update own participant record" ON room_participants;
CREATE POLICY "room_participants_update" ON room_participants
  FOR UPDATE USING (
    (auth_user_id IS NOT NULL AND auth_user_id = auth.uid())
    OR (auth_user_id IS NULL)
  );

-- Frictionless chat
DROP POLICY IF EXISTS "Room members can send messages" ON chat_messages;
DROP POLICY IF EXISTS "Room members can read chat"    ON chat_messages;
CREATE POLICY "chat_insert" ON chat_messages FOR INSERT WITH CHECK (true);
CREATE POLICY "chat_select" ON chat_messages FOR SELECT USING (true);
