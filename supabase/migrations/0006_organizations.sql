-- =====================================================================================================================
-- Sardesk — 0006: ORGANIZZAZIONI, RUOLI, INVITI E CONTROLLI DI ACCESSO
--
-- Cosa fa (idempotente: si può eseguire più volte, non cancella dati):
--   1. nuove tabelle: wa_organizations, wa_org_members (owner / admin / collaborator), wa_client_assignments,
--      wa_invites, wa_settings (impostazioni globali, es. iscrizione libera)
--   2. wa_clients.org_id: ogni cliente appartiene a un'organizzazione
--   3. funzioni di accesso (security definer, senza ricorsioni): wa_is_member, wa_org_role, wa_is_org_admin,
--      wa_can_access_client, wa_can_access_conversation, wa_can_access_storage_path
--   4. RLS riscritta su TUTTE le tabelle wa_ e sui bucket wa-documents / wa-avatars
--   5. funzioni per team e inviti (le uniche vie per cambiare membri, ruoli, assegnazioni, inviti)
--   6. migrazione dati: organizzazione "Sardesk", amministratori attuali (wa_admins) → owner + admin,
--      tutti i clienti esistenti → organizzazione Sardesk
--
-- DB condiviso: tocca solo oggetti con prefisso wa_ (e le policy wa_ sui bucket wa-).
-- Ritorno indietro: supabase/migrations/0006_organizations_rollback.sql
-- =====================================================================================================================

-- ------------------------------------------------------------------------------ 1. tabelle
create table if not exists public.wa_organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  -- piano e limiti: per i pagamenti futuri. null = nessun limite. Li cambia solo il service role / SQL Editor.
  plan text not null default 'free',
  limits jsonb not null default '{"clients": null, "messages_per_month": null, "members": null}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.wa_org_members (
  org_id uuid not null references public.wa_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'collaborator')),
  email text,                                   -- copia per mostrarla nel Team (auth.users non è leggibile dal client)
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- un solo owner per organizzazione
create unique index if not exists wa_org_members_one_owner on public.wa_org_members (org_id) where role = 'owner';
create index if not exists wa_org_members_user on public.wa_org_members (user_id);

create table if not exists public.wa_client_assignments (
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.wa_organizations(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (client_id, user_id)
);
create index if not exists wa_client_assignments_user on public.wa_client_assignments (user_id);
create index if not exists wa_client_assignments_org on public.wa_client_assignments (org_id);

create table if not exists public.wa_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.wa_organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'collaborator')),
  client_ids uuid[] not null default '{}',
  token_hash text not null unique,              -- sha256 del token: il link in chiaro si vede solo alla creazione
  expires_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz
);
create index if not exists wa_invites_org on public.wa_invites (org_id);

create table if not exists public.wa_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
-- iscrizione libera: spenta (solo su invito). Per attivarla: update public.wa_settings set value = 'true' where key = 'public_signup';
insert into public.wa_settings (key, value) values ('public_signup', 'false'::jsonb) on conflict (key) do nothing;

-- ------------------------------------------------------------------------------ 2. cliente → organizzazione
alter table public.wa_clients add column if not exists org_id uuid references public.wa_organizations(id) on delete restrict;
create index if not exists wa_clients_org on public.wa_clients (org_id);

-- ------------------------------------------------------------------------------ 3. funzioni di accesso
-- security definer + search_path vuoto: leggono le tabelle senza passare dalla RLS (niente ricorsioni).
create or replace function public.wa_org_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from public.wa_org_members where org_id = p_org and user_id = auth.uid();
$$;

create or replace function public.wa_is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_org_members where org_id = p_org and user_id = auth.uid());
$$;

create or replace function public.wa_is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_org_members where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin'));
$$;

-- owner/admin dell'organizzazione del cliente, oppure collaboratore a cui il cliente è assegnato
create or replace function public.wa_can_access_client(p_client uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.wa_clients c
    join public.wa_org_members m on m.org_id = c.org_id and m.user_id = auth.uid()
    where c.id = p_client
      and (m.role in ('owner', 'admin')
           or exists (select 1 from public.wa_client_assignments a where a.client_id = c.id and a.user_id = auth.uid()))
  );
$$;

create or replace function public.wa_can_access_conversation(p_conversation uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_conversations v where v.id = p_conversation and public.wa_can_access_client(v.client_id));
$$;

-- file nei bucket: il primo segmento del percorso è l'id del cliente ("<client_id>/file.pdf")
create or replace function public.wa_can_access_storage_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v uuid;
begin
  begin v := split_part(p_name, '/', 1)::uuid; exception when others then return false; end;
  return public.wa_can_access_client(v);
end $$;

-- compatibilità: chi è in wa_admins oppure owner/admin di un'organizzazione (le nuove policy non la usano)
create or replace function public.wa_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_admins where user_id = auth.uid())
      or exists (select 1 from public.wa_org_members where user_id = auth.uid() and role in ('owner', 'admin'));
$$;

-- ------------------------------------------------------------------------------ trigger di protezione
-- wa_clients: org_id impostato in automatico se manca (utente admin di una sola organizzazione), mai spostato
-- da un utente; limite clienti del piano.
create or replace function public.wa_clients_org_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_lim int; v_n int;
begin
  if tg_op = 'INSERT' then
    if new.org_id is null and auth.uid() is not null then
      select m.org_id into v_org from public.wa_org_members m where m.user_id = auth.uid() and m.role in ('owner', 'admin');
      if (select count(*) from public.wa_org_members m where m.user_id = auth.uid() and m.role in ('owner', 'admin')) = 1 then
        new.org_id := v_org;
      end if;
    end if;
    if new.org_id is null and auth.uid() is not null then
      raise exception 'Organizzazione del cliente mancante' using errcode = '42501';
    end if;
    if new.org_id is not null then
      select (o.limits ->> 'clients')::int into v_lim from public.wa_organizations o where o.id = new.org_id;
      if v_lim is not null then
        select count(*) into v_n from public.wa_clients c where c.org_id = new.org_id;
        if v_n >= v_lim then raise exception 'Limite clienti del piano raggiunto (%)', v_lim using errcode = '42501'; end if;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if new.org_id is distinct from old.org_id and auth.uid() is not null then
      raise exception 'Non si può spostare un cliente in un''altra organizzazione' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists wa_clients_org_guard on public.wa_clients;
create trigger wa_clients_org_guard before insert or update on public.wa_clients for each row execute function public.wa_clients_org_guard();

-- wa_organizations: piano e limiti cambiano solo da SQL Editor / service role (pagamenti futuri)
create or replace function public.wa_org_plan_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.plan is distinct from old.plan or new.limits is distinct from old.limits
                                 or new.slug is distinct from old.slug or new.id is distinct from old.id) then
    raise exception 'Piano e limiti non sono modificabili da qui' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists wa_org_plan_guard on public.wa_organizations;
create trigger wa_org_plan_guard before update on public.wa_organizations for each row execute function public.wa_org_plan_guard();

-- ------------------------------------------------------------------------------ 4. RLS
alter table public.wa_organizations enable row level security;
alter table public.wa_org_members enable row level security;
alter table public.wa_client_assignments enable row level security;
alter table public.wa_invites enable row level security;
alter table public.wa_settings enable row level security;
alter table public.wa_admins enable row level security;

drop policy if exists wa_org_select on public.wa_organizations;
create policy wa_org_select on public.wa_organizations for select to authenticated using (public.wa_is_member(id));
drop policy if exists wa_org_update on public.wa_organizations;
create policy wa_org_update on public.wa_organizations for update to authenticated
  using (public.wa_is_org_admin(id)) with check (public.wa_is_org_admin(id));

-- membri: owner/admin vedono tutto il team, un collaboratore solo la propria riga. Scritture solo via funzioni.
drop policy if exists wa_members_select on public.wa_org_members;
create policy wa_members_select on public.wa_org_members for select to authenticated
  using (user_id = auth.uid() or public.wa_is_org_admin(org_id));

drop policy if exists wa_assign_select on public.wa_client_assignments;
create policy wa_assign_select on public.wa_client_assignments for select to authenticated
  using (user_id = auth.uid() or public.wa_is_org_admin(org_id));

drop policy if exists wa_invites_select on public.wa_invites;
create policy wa_invites_select on public.wa_invites for select to authenticated
  using (public.wa_is_org_admin(org_id) or (created_by = auth.uid() and public.wa_is_member(org_id)));

drop policy if exists wa_settings_select on public.wa_settings;
create policy wa_settings_select on public.wa_settings for select to anon, authenticated using (true);

-- clienti
drop policy if exists wa_admin_all on public.wa_clients;
drop policy if exists wa_clients_select on public.wa_clients;
drop policy if exists wa_clients_insert on public.wa_clients;
drop policy if exists wa_clients_update on public.wa_clients;
drop policy if exists wa_clients_delete on public.wa_clients;
create policy wa_clients_select on public.wa_clients for select to authenticated using (public.wa_can_access_client(id));
create policy wa_clients_insert on public.wa_clients for insert to authenticated with check (public.wa_is_org_admin(org_id));
create policy wa_clients_update on public.wa_clients for update to authenticated
  using (public.wa_can_access_client(id)) with check (public.wa_can_access_client(id));
create policy wa_clients_delete on public.wa_clients for delete to authenticated using (public.wa_is_org_admin(org_id));

-- tabelle con client_id: accesso = accesso al cliente
do $$
declare t text;
begin
  foreach t in array array['wa_pages','wa_chunks','wa_crawl_jobs','wa_conversations','wa_leads','wa_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists wa_admin_all on public.%I', t);
    execute format('drop policy if exists wa_client_access on public.%I', t);
    execute format('create policy wa_client_access on public.%I for all to authenticated using (public.wa_can_access_client(client_id)) with check (public.wa_can_access_client(client_id))', t);
  end loop;
end $$;

-- messaggi: tramite la conversazione
alter table public.wa_messages enable row level security;
drop policy if exists wa_admin_all on public.wa_messages;
drop policy if exists wa_client_access on public.wa_messages;
create policy wa_client_access on public.wa_messages for all to authenticated
  using (public.wa_can_access_conversation(conversation_id)) with check (public.wa_can_access_conversation(conversation_id));

-- rate limit: solo service role (Edge Functions)
alter table public.wa_rate_limits enable row level security;
drop policy if exists wa_admin_all on public.wa_rate_limits;

-- storage: percorsi "<client_id>/…"
drop policy if exists wa_documents_admin on storage.objects;
drop policy if exists wa_documents_access on storage.objects;
create policy wa_documents_access on storage.objects for all to authenticated
  using (bucket_id = 'wa-documents' and public.wa_can_access_storage_path(name))
  with check (bucket_id = 'wa-documents' and public.wa_can_access_storage_path(name));
drop policy if exists wa_avatars_admin_select on storage.objects;
drop policy if exists wa_avatars_admin_insert on storage.objects;
drop policy if exists wa_avatars_admin_update on storage.objects;
drop policy if exists wa_avatars_admin_delete on storage.objects;
drop policy if exists wa_avatars_access on storage.objects;
create policy wa_avatars_access on storage.objects for all to authenticated
  using (bucket_id = 'wa-avatars' and public.wa_can_access_storage_path(name))
  with check (bucket_id = 'wa-avatars' and public.wa_can_access_storage_path(name));

-- ------------------------------------------------------------------------------ 5. funzioni per team e inviti
-- token: due uuid v4 (generatore casuale sicuro) → 64 caratteri esadecimali; in tabella solo lo sha256
create or replace function public.wa_new_token() returns text
language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;
create or replace function public.wa_hash_token(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
$$;

-- crea un invito. owner/admin: ruolo admin o collaboratore, qualsiasi cliente dell'organizzazione.
-- collaboratore: solo ruolo collaboratore e solo clienti assegnati anche a lui.
create or replace function public.wa_create_invite(p_org uuid, p_email text, p_role text, p_client_ids uuid[] default '{}', p_days int default 7)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text := public.wa_org_role(p_org);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_clients uuid[] := coalesce(p_client_ids, '{}');
  v_token text := public.wa_new_token();
  v_lim int; v_n int; v_id uuid; v_exp timestamptz;
begin
  if auth.uid() is null or v_role is null then raise exception 'Non fai parte di questa organizzazione' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida' using errcode = '22023'; end if;
  if p_role not in ('admin', 'collaborator') then raise exception 'Ruolo non valido' using errcode = '22023'; end if;
  if v_role = 'collaborator' and p_role <> 'collaborator' then raise exception 'Un collaboratore può invitare solo collaboratori' using errcode = '42501'; end if;
  if exists (select 1 from public.wa_org_members m join auth.users u on u.id = m.user_id where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'Questa persona fa già parte dell''organizzazione' using errcode = '23505';
  end if;
  if p_role = 'admin' then v_clients := '{}'; end if;  -- gli admin vedono già tutti i clienti
  -- i clienti devono essere dell'organizzazione e, per un collaboratore, assegnati anche a lui
  if exists (
    select 1 from unnest(v_clients) cid
    where not exists (select 1 from public.wa_clients c where c.id = cid and c.org_id = p_org)
       or (v_role = 'collaborator' and not exists (select 1 from public.wa_client_assignments a where a.client_id = cid and a.user_id = auth.uid()))
  ) then raise exception 'Puoi assegnare solo clienti a cui hai accesso' using errcode = '42501'; end if;
  if p_role = 'collaborator' and cardinality(v_clients) = 0 then raise exception 'Scegli almeno un cliente per il collaboratore' using errcode = '22023'; end if;
  -- limite membri del piano (membri + inviti in sospeso)
  select (o.limits ->> 'members')::int into v_lim from public.wa_organizations o where o.id = p_org;
  if v_lim is not null then
    select (select count(*) from public.wa_org_members where org_id = p_org)
         + (select count(*) from public.wa_invites where org_id = p_org and accepted_at is null and revoked_at is null and expires_at > now()) into v_n;
    if v_n >= v_lim then raise exception 'Limite membri del piano raggiunto (%)', v_lim using errcode = '42501'; end if;
  end if;
  -- un solo invito valido per email: i precedenti vengono revocati
  update public.wa_invites set revoked_at = now()
   where org_id = p_org and lower(email) = v_email and accepted_at is null and revoked_at is null;
  v_exp := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)));
  insert into public.wa_invites (org_id, email, role, client_ids, token_hash, expires_at, created_by)
  values (p_org, v_email, p_role, (select coalesce(array_agg(distinct x), '{}') from unnest(v_clients) x), public.wa_hash_token(v_token), v_exp, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp);
end $$;

-- nuovo link (il vecchio smette di funzionare) e nuova scadenza
create or replace function public.wa_renew_invite(p_invite uuid, p_days int default 7)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare i public.wa_invites; v_token text := public.wa_new_token(); v_exp timestamptz;
begin
  select * into i from public.wa_invites where id = p_invite;
  if i.id is null or not (public.wa_is_org_admin(i.org_id) or (i.created_by = auth.uid() and public.wa_is_member(i.org_id))) then
    raise exception 'Invito non trovato' using errcode = '42501';
  end if;
  if i.accepted_at is not null then raise exception 'Invito già accettato' using errcode = '22023'; end if;
  v_exp := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)));
  update public.wa_invites set token_hash = public.wa_hash_token(v_token), expires_at = v_exp, revoked_at = null where id = p_invite;
  return jsonb_build_object('id', p_invite, 'token', v_token, 'expires_at', v_exp);
end $$;

create or replace function public.wa_revoke_invite(p_invite uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare i public.wa_invites;
begin
  select * into i from public.wa_invites where id = p_invite;
  if i.id is null or not (public.wa_is_org_admin(i.org_id) or (i.created_by = auth.uid() and public.wa_is_member(i.org_id))) then
    raise exception 'Invito non trovato' using errcode = '42501';
  end if;
  update public.wa_invites set revoked_at = now() where id = p_invite and accepted_at is null;
end $$;

-- informazioni pubbliche su un invito (pagina del link, anche senza login)
create or replace function public.wa_invite_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.wa_invites; v_org text;
begin
  select * into i from public.wa_invites where token_hash = public.wa_hash_token(p_token);
  if i.id is null then return jsonb_build_object('status', 'not_found'); end if;
  select name into v_org from public.wa_organizations where id = i.org_id;
  return jsonb_build_object(
    'status', case when i.accepted_at is not null then 'used' when i.revoked_at is not null then 'revoked' when i.expires_at <= now() then 'expired' else 'valid' end,
    'org_name', v_org, 'email', i.email, 'role', i.role, 'client_count', cardinality(i.client_ids), 'expires_at', i.expires_at);
end $$;

-- accetta: l'utente collegato (con la stessa email dell'invito) entra nell'organizzazione con quel ruolo
create or replace function public.wa_accept_invite(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare i public.wa_invites; v_email text; v_cur text; v_creator_role text;
begin
  if auth.uid() is null then raise exception 'Accedi per accettare l''invito' using errcode = '42501'; end if;
  select * into i from public.wa_invites where token_hash = public.wa_hash_token(p_token) for update;
  if i.id is null or i.revoked_at is not null then raise exception 'Invito non valido o revocato' using errcode = '22023'; end if;
  if i.accepted_at is not null then raise exception 'Questo invito è già stato usato' using errcode = '22023'; end if;
  if i.expires_at <= now() then raise exception 'Invito scaduto: chiedi un nuovo link' using errcode = '22023'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is distinct from lower(i.email) then
    raise exception 'Questo invito è per %: accedi con quell''indirizzo', i.email using errcode = '42501';
  end if;

  select role into v_cur from public.wa_org_members where org_id = i.org_id and user_id = auth.uid();
  if v_cur is null then
    insert into public.wa_org_members (org_id, user_id, role, email, invited_by) values (i.org_id, auth.uid(), i.role, v_email, i.created_by);
    v_cur := i.role;
  elsif v_cur = 'collaborator' and i.role = 'admin' then
    update public.wa_org_members set role = 'admin' where org_id = i.org_id and user_id = auth.uid();
    v_cur := 'admin';
  end if;

  if v_cur = 'collaborator' then
    -- se l'invito viene da un collaboratore, solo i clienti che ha ancora lui
    select role into v_creator_role from public.wa_org_members where org_id = i.org_id and user_id = i.created_by;
    insert into public.wa_client_assignments (client_id, user_id, org_id, assigned_by)
    select c.id, auth.uid(), i.org_id, i.created_by
    from public.wa_clients c
    where c.id = any (i.client_ids) and c.org_id = i.org_id
      and (v_creator_role in ('owner', 'admin')
           or exists (select 1 from public.wa_client_assignments a where a.client_id = c.id and a.user_id = i.created_by))
    on conflict (client_id, user_id) do nothing;
  end if;

  update public.wa_invites set accepted_at = now(), accepted_by = auth.uid() where id = i.id;
  return jsonb_build_object('org_id', i.org_id, 'role', v_cur);
end $$;

-- ruolo di un membro: solo owner/admin; l'owner non si tocca
create or replace function public.wa_set_member_role(p_org uuid, p_user uuid, p_role text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_target text;
begin
  if not public.wa_is_org_admin(p_org) then raise exception 'Solo owner e admin gestiscono il team' using errcode = '42501'; end if;
  if p_role not in ('admin', 'collaborator') then raise exception 'Ruolo non valido' using errcode = '22023'; end if;
  select role into v_target from public.wa_org_members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'Membro non trovato' using errcode = '22023'; end if;
  if v_target = 'owner' then raise exception 'L''owner non può essere declassato' using errcode = '42501'; end if;
  update public.wa_org_members set role = p_role where org_id = p_org and user_id = p_user;
end $$;

-- rimozione: owner/admin rimuovono chiunque tranne l'owner; chiunque (non owner) può uscire da solo
create or replace function public.wa_remove_member(p_org uuid, p_user uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_target text;
begin
  if not (public.wa_is_org_admin(p_org) or p_user = auth.uid()) then raise exception 'Solo owner e admin rimuovono membri' using errcode = '42501'; end if;
  select role into v_target from public.wa_org_members where org_id = p_org and user_id = p_user;
  if v_target is null then raise exception 'Membro non trovato' using errcode = '22023'; end if;
  if v_target = 'owner' then raise exception 'L''owner non può essere rimosso' using errcode = '42501'; end if;
  delete from public.wa_client_assignments where org_id = p_org and user_id = p_user;
  delete from public.wa_org_members where org_id = p_org and user_id = p_user;
end $$;

-- clienti assegnati a un collaboratore (sostituisce l'elenco): solo owner/admin
create or replace function public.wa_set_client_assignments(p_org uuid, p_user uuid, p_client_ids uuid[]) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.wa_is_org_admin(p_org) then raise exception 'Solo owner e admin assegnano i clienti' using errcode = '42501'; end if;
  if not exists (select 1 from public.wa_org_members where org_id = p_org and user_id = p_user and role = 'collaborator') then
    raise exception 'Si assegnano clienti solo ai collaboratori' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_client_ids, '{}')) cid where not exists (select 1 from public.wa_clients c where c.id = cid and c.org_id = p_org)) then
    raise exception 'Cliente non dell''organizzazione' using errcode = '42501';
  end if;
  delete from public.wa_client_assignments where org_id = p_org and user_id = p_user and not (client_id = any (coalesce(p_client_ids, '{}')));
  insert into public.wa_client_assignments (client_id, user_id, org_id, assigned_by)
  select distinct cid, p_user, p_org, auth.uid() from unnest(coalesce(p_client_ids, '{}')) cid
  on conflict (client_id, user_id) do nothing;
end $$;

-- iscrizione libera (se attivata in wa_settings): chi si iscrive crea la propria organizzazione e ne è owner
create or replace function public.wa_signup_create_org(p_name text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_email text; v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then raise exception 'Accedi prima' using errcode = '42501'; end if;
  if coalesce((select value from public.wa_settings where key = 'public_signup'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'L''iscrizione è solo su invito' using errcode = '42501';
  end if;
  if exists (select 1 from public.wa_org_members where user_id = auth.uid()) then raise exception 'Fai già parte di un''organizzazione' using errcode = '23505'; end if;
  if v_name is null then raise exception 'Nome organizzazione mancante' using errcode = '22023'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.wa_organizations (slug, name, plan, created_by)
  values (left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), v_name, 'free', auth.uid())
  returning id into v_org;
  insert into public.wa_org_members (org_id, user_id, role, email) values (v_org, auth.uid(), 'owner', v_email);
  return v_org;
end $$;

-- permessi di esecuzione
do $$
declare f text;
begin
  foreach f in array array[
    'wa_org_role(uuid)', 'wa_is_member(uuid)', 'wa_is_org_admin(uuid)', 'wa_can_access_client(uuid)', 'wa_can_access_conversation(uuid)',
    'wa_can_access_storage_path(text)', 'wa_is_admin()', 'wa_create_invite(uuid,text,text,uuid[],int)', 'wa_renew_invite(uuid,int)',
    'wa_revoke_invite(uuid)', 'wa_accept_invite(text)', 'wa_set_member_role(uuid,uuid,text)', 'wa_remove_member(uuid,uuid)',
    'wa_set_client_assignments(uuid,uuid,uuid[])', 'wa_signup_create_org(text)', 'wa_new_token()', 'wa_hash_token(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  revoke execute on function public.wa_new_token() from authenticated;
  revoke execute on function public.wa_invite_info(text) from public;
  grant execute on function public.wa_invite_info(text) to anon, authenticated, service_role;
end $$;

-- ------------------------------------------------------------------------------ 6. migrazione dati
do $$
declare v_org uuid; v_owner uuid;
begin
  insert into public.wa_organizations (slug, name, plan) values ('sardesk', 'Sardesk', 'internal') on conflict (slug) do nothing;
  select id into v_org from public.wa_organizations where slug = 'sardesk';

  -- tutti gli attuali amministratori diventano admin dell'organizzazione…
  insert into public.wa_org_members (org_id, user_id, role, email)
  select v_org, a.user_id, 'admin', u.email
  from public.wa_admins a join auth.users u on u.id = a.user_id
  on conflict (org_id, user_id) do nothing;

  -- …e il primo in ordine di creazione è l'owner (se l'organizzazione non ne ha ancora uno)
  if not exists (select 1 from public.wa_org_members where org_id = v_org and role = 'owner') then
    select a.user_id into v_owner from public.wa_admins a
    join public.wa_org_members m on m.user_id = a.user_id and m.org_id = v_org
    order by a.created_at, a.user_id limit 1;
    if v_owner is not null then
      update public.wa_org_members set role = 'owner' where org_id = v_org and user_id = v_owner;
    end if;
  end if;

  -- tutti i clienti senza organizzazione → Sardesk
  update public.wa_clients set org_id = v_org where org_id is null;
end $$;

-- ora ogni cliente ha un'organizzazione
alter table public.wa_clients alter column org_id set not null;

-- controllo finale
do $$
declare v_org uuid; n_members int; n_owner int; n_clients int; n_orphans int;
begin
  select id into v_org from public.wa_organizations where slug = 'sardesk';
  select count(*), count(*) filter (where role = 'owner') into n_members, n_owner from public.wa_org_members where org_id = v_org;
  select count(*) into n_clients from public.wa_clients where org_id = v_org;
  select count(*) into n_orphans from public.wa_admins a where not exists (select 1 from public.wa_org_members m where m.user_id = a.user_id);
  raise notice 'Sardesk: organizzazione pronta. Membri: % (owner: %), clienti: %, amministratori senza organizzazione: %', n_members, n_owner, n_clients, n_orphans;
end $$;

notify pgrst, 'reload schema';
