-- Let signed-in users delete their OWN photos (folder "<user id>/") in the byggvakt-bilder bucket.
-- Additive only: creates one policy, changes no data.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'Users can delete own photos'
  ) then
    create policy "Users can delete own photos" on storage.objects
      for delete to authenticated
      using (bucket_id = 'byggvakt-bilder' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
end $$;
