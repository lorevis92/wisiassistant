-- =====================================================================================================
-- WISI Assistant — RECUPERO SCHEMA (allinea il database al codice in un solo passaggio)
--
-- Quando usarlo: se in produzione mancano migrazioni (es. errore "Could not find the 'recrawl_frequency'
-- column of 'wa_clients' in the schema cache"). Riunisce 0001 + 0003 + 0004 (e la parte di 0002 che non
-- richiede segreti) in forma idempotente: si può eseguire anche più volte, su un DB vuoto, parziale o già a posto.
--
-- Come: Supabase → SQL Editor → incolla tutto → Run.
--
-- Sicurezza dati: non cancella né riscrive dati. Crea solo ciò che manca (IF NOT EXISTS), aggiunge colonne
-- mancanti con valori di default, sostituisce funzioni / viste / policy / trigger con la versione attuale.
-- DB condiviso: tocca solo oggetti con prefisso wa_ (bucket wa-documents, wa-avatars).
--
-- NON incluso (richiede valori segreti, vedi 0002_cron.sql e 0003_recrawl.sql): i job pg_cron `wa_reports`
-- (report automatici) e `wa_recrawl` (re-crawl automatico). Senza di essi l'app funziona; mancano solo le
-- esecuzioni pianificate.
-- =====================================================================================================

-- ------------------------------------------------------------------------------ estensioni
create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ------------------------------------------------------------------------------ tabelle (forma minima)
-- Se una tabella esiste già non viene toccata qui; le colonne mancanti si aggiungono più sotto.
create table if not exists public.wa_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique
);
create table if not exists public.wa_pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  url text not null
);
create table if not exists public.wa_chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  page_id uuid not null references public.wa_pages(id) on delete cascade,
  idx int not null default 0,
  content text not null default '',
  url text not null default ''
);
create table if not exists public.wa_crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade
);
create table if not exists public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade
);
create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  role text not null default 'user',
  content text not null default ''
);
create table if not exists public.wa_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade
);
create table if not exists public.wa_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  period_start date not null default current_date,
  period_end date not null default current_date
);
create table if not exists public.wa_rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);
create table if not exists public.wa_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------ colonne (tutte quelle usate dal codice)
-- wa_clients
alter table public.wa_clients add column if not exists created_at timestamptz not null default now();
alter table public.wa_clients add column if not exists updated_at timestamptz not null default now();
alter table public.wa_clients add column if not exists domain text;
alter table public.wa_clients add column if not exists status text not null default 'new';
alter table public.wa_clients add column if not exists model text not null default 'anthropic/claude-haiku-5-5';
alter table public.wa_clients add column if not exists language text not null default 'auto';
alter table public.wa_clients add column if not exists instructions text;
alter table public.wa_clients add column if not exists confidence_threshold numeric not null default 0.35;
alter table public.wa_clients add column if not exists temperature numeric not null default 0.2;
alter table public.wa_clients add column if not exists include_patterns text[] not null default '{}';
alter table public.wa_clients add column if not exists exclude_patterns text[] not null default '{}';
alter table public.wa_clients add column if not exists last_crawl_at timestamptz;
alter table public.wa_clients add column if not exists channels text[] not null default '{web,standalone}';
alter table public.wa_clients add column if not exists allowed_domains text[] not null default '{}';
alter table public.wa_clients add column if not exists widget jsonb not null default '{}'::jsonb;
alter table public.wa_clients add column if not exists rate_limit_per_hour int not null default 60;
alter table public.wa_clients add column if not exists escalation_email text;
alter table public.wa_clients add column if not exists telegram_bot_token text;
alter table public.wa_clients add column if not exists whatsapp_phone_id text;
alter table public.wa_clients add column if not exists whatsapp_token text;
alter table public.wa_clients add column if not exists report_frequency text not null default 'none';
alter table public.wa_clients add column if not exists report_recipients text[] not null default '{}';
alter table public.wa_clients add column if not exists report_auto_send boolean not null default false;
alter table public.wa_clients add column if not exists last_report_at timestamptz;
-- (0003) re-crawl automatico
alter table public.wa_clients add column if not exists recrawl_frequency text not null default 'none';
alter table public.wa_clients add column if not exists last_recrawl_at timestamptz;
alter table public.wa_clients add column if not exists last_recrawl_status text;
alter table public.wa_clients add column if not exists last_recrawl_error text;
alter table public.wa_clients add column if not exists last_recrawl_job_id uuid;
-- widget: mai NULL (il widget legge colori, avatar, testi da qui)
update public.wa_clients set widget = '{}'::jsonb where widget is null or jsonb_typeof(widget) <> 'object';

-- wa_pages
alter table public.wa_pages add column if not exists created_at timestamptz not null default now();
alter table public.wa_pages add column if not exists title text;
alter table public.wa_pages add column if not exists kind text not null default 'page';
alter table public.wa_pages add column if not exists status text not null default 'pending';
alter table public.wa_pages add column if not exists enabled boolean not null default true;
alter table public.wa_pages add column if not exists chunk_count int not null default 0;
alter table public.wa_pages add column if not exists word_count int not null default 0;
alter table public.wa_pages add column if not exists content_hash text;
alter table public.wa_pages add column if not exists error text;
alter table public.wa_pages add column if not exists storage_path text;
alter table public.wa_pages add column if not exists link text;
alter table public.wa_pages add column if not exists last_crawled_at timestamptz;

-- wa_chunks
alter table public.wa_chunks add column if not exists anchor text;
alter table public.wa_chunks add column if not exists heading_path text;
alter table public.wa_chunks add column if not exists title text;
alter table public.wa_chunks add column if not exists embedding vector(1536);
alter table public.wa_chunks add column if not exists token_count int;

-- wa_crawl_jobs
alter table public.wa_crawl_jobs add column if not exists created_at timestamptz not null default now();
alter table public.wa_crawl_jobs add column if not exists started_at timestamptz;
alter table public.wa_crawl_jobs add column if not exists finished_at timestamptz;
alter table public.wa_crawl_jobs add column if not exists status text not null default 'queued';
alter table public.wa_crawl_jobs add column if not exists total_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists done_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists error_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists current_url text;
alter table public.wa_crawl_jobs add column if not exists error text;
-- (0003) storico esecuzioni
alter table public.wa_crawl_jobs add column if not exists trigger text not null default 'manual';
alter table public.wa_crawl_jobs add column if not exists mapped_count int;
alter table public.wa_crawl_jobs add column if not exists new_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists updated_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists unchanged_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists removed_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists summary text;

-- wa_conversations
alter table public.wa_conversations add column if not exists created_at timestamptz not null default now();
alter table public.wa_conversations add column if not exists updated_at timestamptz not null default now();
alter table public.wa_conversations add column if not exists channel text not null default 'web';
alter table public.wa_conversations add column if not exists external_id text;
alter table public.wa_conversations add column if not exists status text not null default 'open';
alter table public.wa_conversations add column if not exists escalation_reason text;
alter table public.wa_conversations add column if not exists visitor_id text;
alter table public.wa_conversations add column if not exists visitor_label text;
alter table public.wa_conversations add column if not exists page_url text;
alter table public.wa_conversations add column if not exists lead_name text;
alter table public.wa_conversations add column if not exists lead_email text;
alter table public.wa_conversations add column if not exists lead_phone text;
alter table public.wa_conversations add column if not exists last_message text;
alter table public.wa_conversations add column if not exists message_count int not null default 0;
alter table public.wa_conversations add column if not exists language text;

-- wa_messages
alter table public.wa_messages add column if not exists created_at timestamptz not null default now();
alter table public.wa_messages add column if not exists sources jsonb;
alter table public.wa_messages add column if not exists no_answer boolean not null default false;
alter table public.wa_messages add column if not exists feedback smallint;
alter table public.wa_messages add column if not exists model text;
alter table public.wa_messages add column if not exists tokens_in int;
alter table public.wa_messages add column if not exists tokens_out int;

-- wa_leads
alter table public.wa_leads add column if not exists conversation_id uuid references public.wa_conversations(id) on delete set null;
alter table public.wa_leads add column if not exists created_at timestamptz not null default now();
alter table public.wa_leads add column if not exists name text;
alter table public.wa_leads add column if not exists email text;
alter table public.wa_leads add column if not exists phone text;
alter table public.wa_leads add column if not exists channel text;

-- wa_reports
alter table public.wa_reports add column if not exists created_at timestamptz not null default now();
alter table public.wa_reports add column if not exists subject text;
alter table public.wa_reports add column if not exists body_md text;
alter table public.wa_reports add column if not exists stats jsonb;
alter table public.wa_reports add column if not exists recipients text[] not null default '{}';
alter table public.wa_reports add column if not exists status text not null default 'draft';
alter table public.wa_reports add column if not exists sent_at timestamptz;
alter table public.wa_reports add column if not exists error text;

-- ------------------------------------------------------------------------------ vincoli e indici
-- unicità (client_id, url): serve all'upsert del crawler (on_conflict=client_id,url)
do $$ begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.wa_pages'::regclass and i.indisunique
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any(i.indkey)) = array['client_id', 'url']
  ) then
    create unique index wa_pages_client_url_uniq on public.wa_pages(client_id, url);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_clients_recrawl_frequency_chk') then
    update public.wa_clients set recrawl_frequency = 'none' where recrawl_frequency not in ('none', 'daily', 'weekly', 'monthly');
    alter table public.wa_clients add constraint wa_clients_recrawl_frequency_chk
      check (recrawl_frequency in ('none', 'daily', 'weekly', 'monthly'));
  end if;
end $$;

create index if not exists wa_pages_client_idx on public.wa_pages(client_id);
create index if not exists wa_chunks_client_idx on public.wa_chunks(client_id);
create index if not exists wa_chunks_page_idx on public.wa_chunks(page_id);
create index if not exists wa_chunks_embedding_idx on public.wa_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists wa_crawl_jobs_client_idx on public.wa_crawl_jobs(client_id, created_at desc);
create index if not exists wa_conversations_client_idx on public.wa_conversations(client_id, created_at desc);
create index if not exists wa_conversations_status_idx on public.wa_conversations(status);
create index if not exists wa_conversations_external_idx on public.wa_conversations(client_id, channel, external_id);
create index if not exists wa_messages_conv_idx on public.wa_messages(conversation_id, created_at);
create index if not exists wa_leads_client_idx on public.wa_leads(client_id, created_at desc);
create index if not exists wa_reports_client_idx on public.wa_reports(client_id, created_at desc);

-- ------------------------------------------------------------------------------ funzioni e trigger
create or replace function public.wa_on_message_insert() returns trigger language plpgsql as $$
begin
  update public.wa_conversations
     set last_message = left(new.content, 200),
         message_count = message_count + 1,
         updated_at = now()
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists wa_messages_after_insert on public.wa_messages;
create trigger wa_messages_after_insert after insert on public.wa_messages for each row execute function public.wa_on_message_insert();

create or replace function public.wa_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists wa_clients_touch on public.wa_clients;
create trigger wa_clients_touch before update on public.wa_clients for each row execute function public.wa_touch_updated_at();

create or replace function public.wa_match_chunks(
  p_client_id uuid,
  p_embedding vector(1536),
  p_match_count int default 8,
  p_min_similarity float default 0.0
) returns table (
  id uuid, page_id uuid, content text, url text, anchor text, heading_path text, title text, similarity float
) language sql stable as $$
  select c.id, c.page_id, c.content, c.url, c.anchor, c.heading_path, c.title,
         1 - (c.embedding <=> p_embedding) as similarity
    from public.wa_chunks c
    join public.wa_pages p on p.id = c.page_id
   where c.client_id = p_client_id
     and p.enabled = true
     and 1 - (c.embedding <=> p_embedding) >= p_min_similarity
   order by c.embedding <=> p_embedding
   limit p_match_count;
$$;

create or replace function public.wa_check_rate_limit(p_key text, p_limit int) returns boolean language plpgsql as $$
declare r record;
begin
  select * into r from public.wa_rate_limits where key = p_key for update;
  if not found then
    insert into public.wa_rate_limits(key, window_start, count) values (p_key, now(), 1);
    return true;
  end if;
  if r.window_start < now() - interval '1 hour' then
    update public.wa_rate_limits set window_start = now(), count = 1 where key = p_key;
    return true;
  end if;
  if r.count >= p_limit then return false; end if;
  update public.wa_rate_limits set count = count + 1 where key = p_key;
  return true;
end $$;

alter table public.wa_admins enable row level security;
create or replace function public.wa_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_admins where user_id = auth.uid());
$$;

revoke execute on function public.wa_is_admin() from public, anon;
grant execute on function public.wa_is_admin() to authenticated, service_role;
revoke execute on function public.wa_match_chunks(uuid, vector, int, float) from public, anon;
revoke execute on function public.wa_check_rate_limit(text, int) from public, anon;
grant execute on function public.wa_match_chunks(uuid, vector, int, float) to service_role;
grant execute on function public.wa_check_rate_limit(text, int) to service_role;

-- primo admin (come in 0001): nessun effetto se è già presente
do $$ begin
  insert into public.wa_admins (user_id)
  select id from auth.users where lower(email) = 'lorewhiskey@gmail.com'
  on conflict (user_id) do nothing;
end $$;

-- ------------------------------------------------------------------------------ vista statistiche (dashboard)
create or replace view public.wa_client_stats with (security_invoker = true) as
select c.id as client_id,
  (select count(*) from public.wa_pages p where p.client_id = c.id and p.status = 'ok' and p.enabled) as pages_indexed,
  (select coalesce(sum(p.chunk_count),0) from public.wa_pages p where p.client_id = c.id and p.enabled) as chunks,
  (select count(*) from public.wa_conversations v where v.client_id = c.id and v.created_at > now() - interval '30 days') as conversations_30d,
  (select count(*) from public.wa_messages m join public.wa_conversations v on v.id = m.conversation_id where v.client_id = c.id and m.created_at > now() - interval '30 days') as messages_30d,
  (select count(*) from public.wa_conversations v where v.client_id = c.id and v.status in ('escalated','human')) as open_escalations,
  (select count(*) from public.wa_leads l where l.client_id = c.id) as leads,
  (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where v.status not in ('escalated','human')) / count(*)) end
     from public.wa_conversations v where v.client_id = c.id and v.created_at > now() - interval '30 days') as resolution_rate
from public.wa_clients c;

-- ------------------------------------------------------------------------------ RLS: accesso solo agli admin
-- (widget, pagina standalone e canali passano dalle Edge Functions con service role)
do $$
declare t text;
begin
  foreach t in array array['wa_clients','wa_pages','wa_chunks','wa_crawl_jobs','wa_conversations','wa_messages','wa_leads','wa_reports','wa_rate_limits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists wa_admin_all on public.%I', t);
    execute format('create policy wa_admin_all on public.%I for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin())', t);
  end loop;
end $$;

-- ------------------------------------------------------------------------------ realtime (aggiornamenti live in dashboard)
do $$
declare t text;
begin
  foreach t in array array['wa_clients','wa_pages','wa_crawl_jobs','wa_conversations','wa_messages'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      begin
        execute format('alter publication supabase_realtime add table public.%I', t);
      exception when others then raise notice 'realtime: % non aggiunta (%)', t, sqlerrm;
      end;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------------------ storage
-- wa-documents: privato, documenti caricati in Knowledge
insert into storage.buckets (id, name, public) values ('wa-documents', 'wa-documents', false) on conflict (id) do nothing;
drop policy if exists wa_documents_admin on storage.objects;
create policy wa_documents_admin on storage.objects for all to authenticated
  using (bucket_id = 'wa-documents' and public.wa_is_admin())
  with check (bucket_id = 'wa-documents' and public.wa_is_admin());

-- (0004) wa-avatars: pubblico in lettura (immagini del widget), scrittura solo admin
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-avatars', 'wa-avatars', true, 2097152, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
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

-- ------------------------------------------------------------------------------ cron senza segreti (0002)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'wa_ratelimit_cleanup') then
    perform cron.unschedule('wa_ratelimit_cleanup');
  end if;
  perform cron.schedule('wa_ratelimit_cleanup', '15 3 * * *', $c$ delete from public.wa_rate_limits where window_start < now() - interval '2 hours'; $c$);
exception when others then raise notice 'pg_cron non disponibile: %', sqlerrm;
end $$;

-- ------------------------------------------------------------------------------ verifica + cache dello schema
do $$
declare missing text;
begin
  select string_agg(c, ', ') into missing from unnest(array['recrawl_frequency','last_recrawl_at','last_recrawl_status','last_recrawl_error','last_recrawl_job_id','widget']) c
  where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wa_clients' and column_name = c);
  if missing is not null then raise exception 'Colonne ancora mancanti in wa_clients: %', missing; end if;
  raise notice 'WISI Assistant: schema allineato.';
end $$;

-- PostgREST (API di Supabase) ricarica lo schema: sparisce l'errore "... in the schema cache"
notify pgrst, 'reload schema';
