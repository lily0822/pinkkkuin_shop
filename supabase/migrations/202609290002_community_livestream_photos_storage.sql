-- Private Supabase Storage bucket for 社群連線訂單 photos (LINE image
-- ordering, see 202609290001). Not public — the backend only ever reads
-- photos through short-lived signed URLs created server-side with the
-- service-role key (src/lib/supabase/storage.ts), and the LINE carousel
-- reuses the same mechanism with a longer-lived signed URL so LINE's
-- servers can actually fetch the image. There is no public read policy.

insert into storage.buckets (id, name, public)
values ('community-livestream-photos', 'community-livestream-photos', false)
on conflict (id) do nothing;

drop policy if exists "community_livestream_photos_service_role_all" on storage.objects;
create policy "community_livestream_photos_service_role_all"
on storage.objects
for all
to service_role
using (bucket_id = 'community-livestream-photos')
with check (bucket_id = 'community-livestream-photos');
