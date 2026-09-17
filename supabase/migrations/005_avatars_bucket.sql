-- ============================================================
-- 005_avatars_bucket.sql
-- Storage bucket for user profile-picture uploads.
-- ============================================================
-- A NEW bucket, not a reuse of the existing `shared-files` one — that
-- bucket's "Allow public uploads" policy has no auth check at all
-- (`with_check: bucket_id = 'shared-files'`, no `auth.uid()` involved),
-- which is fine for ephemeral in-meeting file shares but wrong for profile
-- pictures: anyone, including a guest with no account, could otherwise
-- overwrite any user's avatar. Avatars need public *reads* (so an avatar
-- URL saved on `profiles.avatar_url` renders for every viewer without an
-- auth round-trip) but writes restricted to the signed-in owner, and only
-- into their own path.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Anyone can view any avatar (public bucket, public read policy) — matches
-- how avatar_url is already consumed: a plain public URL stored on the
-- profiles row and rendered directly in an <img> tag everywhere, no signed
-- URLs, no auth header.
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Upload path convention is `{auth.uid()}/{timestamp}.{ext}` (enforced by
-- the upload code, not just convention here) — storage.foldername(name)[1]
-- is the first path segment, so this policy requires it to match the
-- caller's own auth id. A signed-in user can only ever write into their own
-- folder, never anyone else's.
create policy "Users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Replacing a profile picture re-uses the same path prefix (new
-- timestamp-named file each time, so this is really about allowing cleanup/
-- overwrite of a user's own prior uploads, not literal overwrites of one
-- exact key).
create policy "Users can update their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Removing a profile picture (revert to initials avatar) deletes the
-- uploaded object — same own-folder restriction.
create policy "Users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
