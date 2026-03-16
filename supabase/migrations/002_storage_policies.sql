-- Run this AFTER creating the coffee-bags bucket in Storage UI
-- Storage bucket must exist first (create via Dashboard: Storage > New bucket > coffee-bags, check Public)

-- Allow public read (anyone can fetch images)
create policy "Public read coffee bags"
on storage.objects for select
using (bucket_id = 'coffee-bags');

-- Allow authenticated upload
create policy "Authenticated upload coffee bags"
on storage.objects for insert
to authenticated
with check (bucket_id = 'coffee-bags');

-- Allow authenticated update/delete (for replacing images)
create policy "Authenticated update coffee bags"
on storage.objects for update
to authenticated
using (bucket_id = 'coffee-bags');
