-- =====================================================================================================================
-- Sardesk — 0008: CONTROLLI SULL'EMAIL (registrazione e inviti). Richiede 0006 e 0007. Idempotente, non tocca dati.
--
--  - wa_email_has_account(email): true/false, solo per il service role (Edge Function check-email, con limiti per IP
--    e globali). Conta gli account con email confermata: un account mai confermato può ripetere la registrazione
--    (Supabase rimanda l'email di conferma).
--  - wa_invite_preview(org, email): per chi può invitare in quell'organizzazione, dice subito nella finestra d'invito
--    'member' (già nel team) | 'existing' (ha già un account: vedrà l'invito nell'app) | 'new' (partirà l'email
--    d'iscrizione). Stessa regola di wa_create_invite (0007). Limite: 120 controlli all'ora per utente.
-- auth.users viene solo letto.
-- =====================================================================================================================

create or replace function public.wa_email_has_account(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.users u where lower(u.email) = lower(trim(coalesce(p_email, ''))) and u.email_confirmed_at is not null);
$$;
revoke execute on function public.wa_email_has_account(text) from public, anon, authenticated;
grant execute on function public.wa_email_has_account(text) to service_role;

create or replace function public.wa_invite_preview(p_org uuid, p_email text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if auth.uid() is null or not public.wa_is_member(p_org) then raise exception 'Non fai parte di questa organizzazione' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid'; end if;
  if not public.wa_check_rate_limit('invite-preview:' || auth.uid()::text, 120) then
    raise exception 'Troppi controlli: riprova tra poco' using errcode = '54000';
  end if;
  if exists (select 1 from public.wa_org_members m join auth.users u on u.id = m.user_id where m.org_id = p_org and lower(u.email) = v_email) then
    return 'member';
  end if;
  return case when exists (select 1 from auth.users u where lower(u.email) = v_email and u.email_confirmed_at is not null) then 'existing' else 'new' end;
end $$;
revoke execute on function public.wa_invite_preview(uuid, text) from public, anon;
grant execute on function public.wa_invite_preview(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
