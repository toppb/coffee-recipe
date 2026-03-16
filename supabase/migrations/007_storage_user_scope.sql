-- Scope image uploads to user's own folder: {user_id}/coffee-bag-{num}.webp

drop policy if exists "Authenticated upload coffee bags" on storage.objects;
drop policy if exists "Authenticated update coffee bags" on storage.objects;

-- Owner can upload to their own folder
create policy "Owner upload coffee bags" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'coffee-bags'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can update/replace their own images
create policy "Owner update coffee bags" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'coffee-bags'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Public read stays (from 002_storage_policies.sql)
