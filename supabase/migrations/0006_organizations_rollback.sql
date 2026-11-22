-- =====================================================================================================================
-- Sardesk — RITORNO INDIETRO da 0006_organizations.sql
--
-- Rimette i controlli di accesso di prima: entra solo chi è in wa_admins e vede tutti i clienti.
-- NON cancella dati: organizzazioni, membri, inviti e la colonna wa_clients.org_id restano (servono se riesegui la 0006).
-- Chi era entrato solo tramite invito (collaboratori, nuovi admin) perde l'accesso finché non riesegui la 0006,
-- a meno che tu non lo aggiunga a wa_admins.
-- Dopo questo script, se hai già pubblicato il nuovo frontend e le nuove funzioni, torna anche alla versione precedente
-- del codice (vedi README → "Organizzazioni e ruoli").
-- =====================================================================================================================

-- wa_is_admin come in origine
create or replace function public.wa_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_admins where user_id = auth.uid());
$$;

-- policy "solo admin" su tutte le tabelle wa_ con dati
do $$
declare t text;
begin
  foreach t in array array['wa_clients','wa_pages','wa_chunks','wa_crawl_jobs','wa_conversations','wa_messages','wa_leads','wa_reports','wa_rate_limits'] loop
    execute format('drop policy if exists wa_client_access on public.%I', t);
    execute format('drop policy if exists wa_admin_all on public.%I', t);
    execute format('create policy wa_admin_all on public.%I for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin())', t);
  end loop;
end $$;
drop policy if exists wa_clients_select on public.wa_clients;
drop policy if exists wa_clients_insert on public.wa_clients;
drop policy if exists wa_clients_update on public.wa_clients;
drop policy if exists wa_clients_delete on public.wa_clients;

-- i clienti si possono creare di nuovo senza organizzazione
drop trigger if exists wa_clients_org_guard on public.wa_clients;
alter table public.wa_clients alter column org_id drop not null;

-- storage come prima
drop policy if exists wa_documents_access on storage.objects;
drop policy if exists wa_documents_admin on storage.objects;
create policy wa_documents_admin on storage.objects for all to authenticated
  using (bucket_id = 'wa-documents' and public.wa_is_admin())
  with check (bucket_id = 'wa-documents' and public.wa_is_admin());
drop policy if exists wa_avatars_access on storage.objects;
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

-- le funzioni di team/inviti non sono più utilizzabili dal pannello
do $$
declare f text;
begin
  foreach f in array array['wa_create_invite(uuid,text,text,uuid[],int)', 'wa_renew_invite(uuid,int)', 'wa_revoke_invite(uuid)',
    'wa_accept_invite(text)', 'wa_set_member_role(uuid,uuid,text)', 'wa_remove_member(uuid,uuid)',
    'wa_set_client_assignments(uuid,uuid,uuid[])', 'wa_signup_create_org(text)'] loop
    execute format('revoke execute on function public.%s from authenticated, anon', f);
  end loop;
  revoke execute on function public.wa_invite_info(text) from anon, authenticated;
end $$;

-- (facoltativo, CANCELLA i dati di team e inviti: togli i commenti solo se vuoi eliminarli del tutto)
-- drop table if exists public.wa_invites, public.wa_client_assignments, public.wa_org_members cascade;
-- alter table public.wa_clients drop column if exists org_id;
-- drop table if exists public.wa_organizations, public.wa_settings cascade;

notify pgrst, 'reload schema';
