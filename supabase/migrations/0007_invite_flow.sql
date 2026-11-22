-- =====================================================================================================================
-- Sardesk — 0007: NUOVO FLUSSO INVITI E ISCRIZIONE (richiede 0006; idempotente, non cancella dati)
--
--  - wa_invites: target_existed (all'invio esisteva già un account confermato con quell'email?), declined_at, stato
--    dell'email (email_sent_at, email_channel, email_error)
--  - account NUOVO (target_existed = false): appena la persona accede con l'email verificata entra da sola
--    nell'organizzazione (wa_claim_invites, chiamata dal pannello a ogni accesso)
--  - account ESISTENTE (target_existed = true): l'invito compare in "Inviti ricevuti" con Accetta / Rifiuta
--    (wa_my_invites, wa_respond_invite)
--  - ogni ingresso (automatico, accettazione, link) richiede email VERIFICATA e uguale a quella invitata
--  - wa_signup_create_org resta l'unico modo di creare un'organizzazione: solo con iscrizione libera accesa e solo
--    su richiesta esplicita (pulsante "Crea la tua organizzazione")
-- Nessun oggetto fuori dal prefisso wa_ viene creato o modificato (auth.users viene solo letto).
-- =====================================================================================================================

alter table public.wa_invites add column if not exists target_existed boolean;
alter table public.wa_invites add column if not exists declined_at timestamptz;
alter table public.wa_invites add column if not exists email_sent_at timestamptz;
alter table public.wa_invites add column if not exists email_channel text;   -- 'supabase' | 'resend'
alter table public.wa_invites add column if not exists email_error text;
create index if not exists wa_invites_email on public.wa_invites (lower(email));

-- email dell'utente collegato, solo se verificata (null altrimenti)
create or replace function public.wa_my_verified_email() returns text
language sql stable security definer set search_path = '' as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null;
$$;

-- stato di un invito (anche per la pagina Team)
create or replace function public.wa_invite_status(i public.wa_invites) returns text
language sql stable set search_path = '' as $$
  select case
    when i.accepted_at is not null then 'accepted'
    when i.declined_at is not null then 'declined'
    when i.revoked_at is not null then 'revoked'
    when i.expires_at <= now() then 'expired'
    else 'pending' end;
$$;

-- ingresso nell'organizzazione da un invito (interna: la usano solo le funzioni qui sotto, già controllate)
create or replace function public.wa_join_invite(p_invite uuid, p_user uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare i public.wa_invites; v_email text; v_cur text; v_creator_role text;
begin
  select * into i from public.wa_invites where id = p_invite for update;
  if i.id is null or public.wa_invite_status(i) <> 'pending' then raise exception 'Invito non più valido' using errcode = '22023'; end if;
  select lower(email) into v_email from auth.users where id = p_user and email_confirmed_at is not null;
  if v_email is null then raise exception 'Conferma prima il tuo indirizzo email' using errcode = '42501'; end if;
  if v_email <> lower(i.email) then raise exception 'Questo invito è per %: accedi con quell''indirizzo', i.email using errcode = '42501'; end if;

  select role into v_cur from public.wa_org_members where org_id = i.org_id and user_id = p_user;
  if v_cur is null then
    insert into public.wa_org_members (org_id, user_id, role, email, invited_by) values (i.org_id, p_user, i.role, v_email, i.created_by);
    v_cur := i.role;
  elsif v_cur = 'collaborator' and i.role = 'admin' then
    update public.wa_org_members set role = 'admin' where org_id = i.org_id and user_id = p_user;
    v_cur := 'admin';
  end if;

  if v_cur = 'collaborator' then
    -- se l'invito viene da un collaboratore, solo i clienti che ha ancora lui
    select role into v_creator_role from public.wa_org_members where org_id = i.org_id and user_id = i.created_by;
    insert into public.wa_client_assignments (client_id, user_id, org_id, assigned_by)
    select c.id, p_user, i.org_id, i.created_by
    from public.wa_clients c
    where c.id = any (i.client_ids) and c.org_id = i.org_id
      and (v_creator_role in ('owner', 'admin')
           or exists (select 1 from public.wa_client_assignments a where a.client_id = c.id and a.user_id = i.created_by))
    on conflict (client_id, user_id) do nothing;
  end if;

  update public.wa_invites set accepted_at = now(), accepted_by = p_user where id = i.id;
  return jsonb_build_object('org_id', i.org_id, 'role', v_cur);
end $$;

-- crea un invito (stesse regole della 0006) + registra se l'account esiste già
create or replace function public.wa_create_invite(p_org uuid, p_email text, p_role text, p_client_ids uuid[] default '{}', p_days int default 7)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_role text := public.wa_org_role(p_org);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_clients uuid[] := coalesce(p_client_ids, '{}');
  v_token text := public.wa_new_token();
  v_existed boolean;
  v_lim int; v_n int; v_id uuid; v_exp timestamptz;
begin
  if auth.uid() is null or v_role is null then raise exception 'Non fai parte di questa organizzazione' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida' using errcode = '22023'; end if;
  if p_role not in ('admin', 'collaborator') then raise exception 'Ruolo non valido' using errcode = '22023'; end if;
  if v_role = 'collaborator' and p_role <> 'collaborator' then raise exception 'Un collaboratore può invitare solo collaboratori' using errcode = '42501'; end if;
  if exists (select 1 from public.wa_org_members m join auth.users u on u.id = m.user_id where m.org_id = p_org and lower(u.email) = v_email) then
    raise exception 'Questa persona fa già parte dell''organizzazione' using errcode = '23505';
  end if;
  if p_role = 'admin' then v_clients := '{}'; end if;
  if exists (
    select 1 from unnest(v_clients) cid
    where not exists (select 1 from public.wa_clients c where c.id = cid and c.org_id = p_org)
       or (v_role = 'collaborator' and not exists (select 1 from public.wa_client_assignments a where a.client_id = cid and a.user_id = auth.uid()))
  ) then raise exception 'Puoi assegnare solo clienti a cui hai accesso' using errcode = '42501'; end if;
  if p_role = 'collaborator' and cardinality(v_clients) = 0 then raise exception 'Scegli almeno un cliente per il collaboratore' using errcode = '22023'; end if;
  select (o.limits ->> 'members')::int into v_lim from public.wa_organizations o where o.id = p_org;
  if v_lim is not null then
    select (select count(*) from public.wa_org_members where org_id = p_org)
         + (select count(*) from public.wa_invites i where i.org_id = p_org and public.wa_invite_status(i) = 'pending') into v_n;
    if v_n >= v_lim then raise exception 'Limite membri del piano raggiunto (%)', v_lim using errcode = '42501'; end if;
  end if;
  update public.wa_invites set revoked_at = now()
   where org_id = p_org and lower(email) = v_email and accepted_at is null and revoked_at is null and declined_at is null;
  -- account esistente = utente con questa email e indirizzo già confermato
  v_existed := exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null);
  v_exp := now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 30)));
  insert into public.wa_invites (org_id, email, role, client_ids, token_hash, expires_at, created_by, target_existed)
  values (p_org, v_email, p_role, (select coalesce(array_agg(distinct x), '{}') from unnest(v_clients) x), public.wa_hash_token(v_token), v_exp, auth.uid(), v_existed)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_exp, 'target_existed', v_existed);
end $$;

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
  update public.wa_invites set token_hash = public.wa_hash_token(v_token), expires_at = v_exp, revoked_at = null, declined_at = null,
    email_sent_at = null, email_channel = null, email_error = null,
    target_existed = exists (select 1 from auth.users u where lower(u.email) = lower(i.email) and u.email_confirmed_at is not null)
  where id = p_invite;
  return jsonb_build_object('id', p_invite, 'token', v_token, 'expires_at', v_exp);
end $$;

-- link copiato: come prima, ma serve l'email verificata
create or replace function public.wa_accept_invite(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare i public.wa_invites;
begin
  if auth.uid() is null then raise exception 'Accedi per accettare l''invito' using errcode = '42501'; end if;
  select * into i from public.wa_invites where token_hash = public.wa_hash_token(p_token);
  if i.id is null then raise exception 'Invito non valido' using errcode = '22023'; end if;
  case public.wa_invite_status(i)
    when 'accepted' then raise exception 'Questo invito è già stato usato' using errcode = '22023';
    when 'declined' then raise exception 'Questo invito è stato rifiutato' using errcode = '22023';
    when 'revoked' then raise exception 'Invito revocato' using errcode = '22023';
    when 'expired' then raise exception 'Invito scaduto: chiedi un nuovo link' using errcode = '22023';
    else null;
  end case;
  return public.wa_join_invite(i.id, auth.uid());
end $$;

create or replace function public.wa_invite_info(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare i public.wa_invites; v_org text; v_st text;
begin
  select * into i from public.wa_invites where token_hash = public.wa_hash_token(p_token);
  if i.id is null then return jsonb_build_object('status', 'not_found'); end if;
  select name into v_org from public.wa_organizations where id = i.org_id;
  v_st := public.wa_invite_status(i);
  return jsonb_build_object('status', case v_st when 'accepted' then 'used' when 'pending' then 'valid' else v_st end,
    'org_name', v_org, 'email', i.email, 'role', i.role, 'client_count', cardinality(i.client_ids), 'expires_at', i.expires_at);
end $$;

-- inviti ricevuti dall'utente collegato (email verificata), ancora da decidere
create or replace function public.wa_my_invites() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'org_id', i.org_id, 'org_name', o.name, 'role', i.role, 'client_count', cardinality(i.client_ids),
    'invited_by', (select m.email from public.wa_org_members m where m.org_id = i.org_id and m.user_id = i.created_by),
    'expires_at', i.expires_at, 'created_at', i.created_at) order by i.created_at desc), '[]'::jsonb)
  from public.wa_invites i join public.wa_organizations o on o.id = i.org_id
  where lower(i.email) = public.wa_my_verified_email()
    and public.wa_invite_status(i) = 'pending'
    and not exists (select 1 from public.wa_org_members m where m.org_id = i.org_id and m.user_id = auth.uid());
$$;

-- Accetta / Rifiuta un invito ricevuto
create or replace function public.wa_respond_invite(p_invite uuid, p_accept boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare i public.wa_invites; v_email text := public.wa_my_verified_email();
begin
  if auth.uid() is null then raise exception 'Accedi prima' using errcode = '42501'; end if;
  if v_email is null then raise exception 'Conferma prima il tuo indirizzo email' using errcode = '42501'; end if;
  select * into i from public.wa_invites where id = p_invite;
  if i.id is null or lower(i.email) <> v_email then raise exception 'Invito non trovato' using errcode = '22023'; end if;
  if public.wa_invite_status(i) <> 'pending' then raise exception 'Invito non più valido' using errcode = '22023'; end if;
  if p_accept then return public.wa_join_invite(i.id, auth.uid()); end if;
  update public.wa_invites set declined_at = now() where id = i.id;
  return jsonb_build_object('declined', true);
end $$;

-- ingresso automatico per chi è stato invitato quando non aveva un account: chiamata dal pannello a ogni accesso
create or replace function public.wa_claim_invites() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare v_email text := public.wa_my_verified_email(); r record; n int := 0;
begin
  if auth.uid() is null or v_email is null then return 0; end if;
  for r in
    select i.id from public.wa_invites i
    where lower(i.email) = v_email and i.target_existed = false and public.wa_invite_status(i) = 'pending'
      and not exists (select 1 from public.wa_org_members m where m.org_id = i.org_id and m.user_id = auth.uid())
    order by i.created_at
  loop
    begin
      perform public.wa_join_invite(r.id, auth.uid());
      n := n + 1;
    exception when others then raise notice 'wa_claim_invites: %', sqlerrm;
    end;
  end loop;
  return n;
end $$;

-- iscrizione libera: crea un'organizzazione SOLO su richiesta esplicita, con email verificata
create or replace function public.wa_signup_create_org(p_name text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; v_email text := public.wa_my_verified_email(); v_name text := nullif(trim(coalesce(p_name, '')), '');
begin
  if auth.uid() is null then raise exception 'Accedi prima' using errcode = '42501'; end if;
  if coalesce((select value from public.wa_settings where key = 'public_signup'), 'false'::jsonb) <> 'true'::jsonb then
    raise exception 'L''iscrizione è solo su invito' using errcode = '42501';
  end if;
  if v_email is null then raise exception 'Conferma prima il tuo indirizzo email' using errcode = '42501'; end if;
  if exists (select 1 from public.wa_org_members where user_id = auth.uid()) then raise exception 'Fai già parte di un''organizzazione' using errcode = '23505'; end if;
  if v_name is null then raise exception 'Nome organizzazione mancante' using errcode = '22023'; end if;
  insert into public.wa_organizations (slug, name, plan, created_by)
  values (left(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6), v_name, 'free', auth.uid())
  returning id into v_org;
  insert into public.wa_org_members (org_id, user_id, role, email) values (v_org, auth.uid(), 'owner', v_email);
  return v_org;
end $$;

-- permessi
do $$
declare f text;
begin
  foreach f in array array['wa_my_verified_email()', 'wa_create_invite(uuid,text,text,uuid[],int)', 'wa_renew_invite(uuid,int)',
    'wa_accept_invite(text)', 'wa_my_invites()', 'wa_respond_invite(uuid,boolean)', 'wa_claim_invites()', 'wa_signup_create_org(text)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- interna: nessun accesso diretto dal client
  revoke execute on function public.wa_join_invite(uuid, uuid) from public, anon, authenticated;
  grant execute on function public.wa_join_invite(uuid, uuid) to service_role;
  revoke execute on function public.wa_invite_status(public.wa_invites) from public, anon;
  grant execute on function public.wa_invite_status(public.wa_invites) to authenticated, service_role;
  revoke execute on function public.wa_invite_info(text) from public;
  grant execute on function public.wa_invite_info(text) to anon, authenticated, service_role;
end $$;

-- inviti già esistenti (creati con la 0006): vanno accettati esplicitamente, come prima
update public.wa_invites set target_existed = true where target_existed is null;

notify pgrst, 'reload schema';
