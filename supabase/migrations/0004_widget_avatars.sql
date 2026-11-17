-- Immagini profilo del widget (pallino + testata), caricate da Impostazioni → Aspetto.
-- Idempotente. DB condiviso: tocca solo il bucket wa-avatars e le sue policy (prefisso wa_).
--
-- Bucket pubblico in lettura: il widget sui siti dei clienti mostra l'immagine tramite URL pubblico
-- (/storage/v1/object/public/wa-avatars/<client_id>/avatar-<timestamp>.webp), senza login.
-- Scrittura, modifica e cancellazione solo per gli admin (public.wa_is_admin()).
-- Le immagini vengono già ritagliate quadrate e ridimensionate a 256 px nel pannello admin.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-avatars', 'wa-avatars', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists wa_avatars_admin_select on storage.objects;
create policy wa_avatars_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'wa-avatars' and public.wa_is_admin());

drop policy if exists wa_avatars_admin_insert on storage.objects;
create policy wa_avatars_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'wa-avatars' and public.wa_is_admin());

drop policy if exists wa_avatars_admin_update on storage.objects;
create policy wa_avatars_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'wa-avatars' and public.wa_is_admin())
  with check (bucket_id = 'wa-avatars' and public.wa_is_admin());

drop policy if exists wa_avatars_admin_delete on storage.objects;
create policy wa_avatars_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'wa-avatars' and public.wa_is_admin());
