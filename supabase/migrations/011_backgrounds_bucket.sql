-- ============================================================
-- 011_backgrounds_bucket.sql
-- Storage bucket for a user's saved virtual-background images.
-- ============================================================
-- Same shape as 005_avatars_bucket.sql, for the same reasons: a NEW bucket
-- rather than a reuse of `shared-files` (whose upload policy has no auth
-- check at all), public *reads* so a saved background renders straight into
-- the compositing pipeline from its public URL with no signed-URL dance, and
-- writes restricted to the signed-in owner inside their own folder.
--
-- Unlike avatars this is a *library*, not a single slot: a user keeps any
-- reasonable number of backgrounds under `{auth.uid()}/` and the client
-- lists that folder to build the "My Backgrounds" picker. Each object is
-- named `{timestamp}__{label}.jpg` so the friendly label round-trips
-- without a companion table (see components/useBackgrounds.ts).
--
-- Guests (Start Now without an account) never touch this bucket — they get
-- a localStorage-backed library instead, same picker, no sync.
insert into storage.buckets (id, name, public)
values ('backgrounds', 'backgrounds', true)
on conflict (id) do nothing;

create policy "Background images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'backgrounds');

-- storage.foldername(name)[1] is the first path segment; the upload code
-- always writes `{auth.uid()}/…`, and this policy makes that mandatory.
create policy "Users can upload their own backgrounds"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can update their own backgrounds"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete their own backgrounds"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'backgrounds' and (storage.foldername(name))[1] = auth.uid()::text);
