-- WISI Assistant — schema iniziale
-- Eseguire in Supabase → SQL Editor (oppure `supabase db push`). Idempotente.
--
-- DB CONDIVISO ("wisinvaders"): tutti gli oggetti di questa app hanno prefisso wa_ (bucket: wa-documents).
-- Questa migration crea/sostituisce/elimina SOLO oggetti con prefisso wa_ e non tocca tabelle, funzioni
-- o policy di altre app. Le estensioni sono solo "create if not exists".

create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================ CLIENTS
create table if not exists public.wa_clients (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  slug text not null unique,
  domain text,
  status text not null default 'new', -- new | mapping | crawling | indexing | ready | paused | error
  -- AI
  model text not null default 'anthropic/claude-haiku-5-5', -- provider/model-id (vedi src/lib/models.js)
  language text not null default 'auto',
  instructions text,
  confidence_threshold numeric not null default 0.35,
  temperature numeric not null default 0.2,
  -- crawling
  include_patterns text[] not null default '{}',
  exclude_patterns text[] not null default '{}',
  last_crawl_at timestamptz,
  -- channels & widget
  channels text[] not null default '{web,standalone}',
  allowed_domains text[] not null default '{}',
  widget jsonb not null default '{}'::jsonb,
  rate_limit_per_hour int not null default 60,
  escalation_email text,
  telegram_bot_token text,
  whatsapp_phone_id text,
  whatsapp_token text,
  -- reports
  report_frequency text not null default 'none', -- none | weekly | biweekly | monthly
  report_recipients text[] not null default '{}',
  report_auto_send boolean not null default false,
  last_report_at timestamptz
);

-- ============================================================ PAGES (site pages + manual docs/faq/text)
create table if not exists public.wa_pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  url text not null,            -- page URL, or wisi://doc/<id> for manual content
  title text,
  kind text not null default 'page', -- page | document | faq | text
  status text not null default 'pending', -- pending | ok | failed | empty
  enabled boolean not null default true,
  chunk_count int not null default 0,
  word_count int not null default 0,
  content_hash text,
  error text,
  storage_path text,
  link text,                    -- link to propose for manual content
  last_crawled_at timestamptz,
  unique (client_id, url)
);
create index if not exists wa_pages_client_idx on public.wa_pages(client_id);

-- ============================================================ CHUNKS (pgvector)
create table if not exists public.wa_chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  page_id uuid not null references public.wa_pages(id) on delete cascade,
  idx int not null,
  content text not null,
  url text not null,           -- page URL
  anchor text,                 -- #section-id when available → url#anchor
  heading_path text,           -- "H1 > H2 > H3"
  title text,
  embedding vector(1536),
  token_count int
);
create index if not exists wa_chunks_client_idx on public.wa_chunks(client_id);
create index if not exists wa_chunks_page_idx on public.wa_chunks(page_id);
-- HNSW works well up to millions of rows; cosine distance
create index if not exists wa_chunks_embedding_idx on public.wa_chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================ CRAWL JOBS
create table if not exists public.wa_crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'queued', -- queued | running | done | error | cancelled
  total_count int not null default 0,
  done_count int not null default 0,
  error_count int not null default 0,
  current_url text,
  error text
);
create index if not exists wa_crawl_jobs_client_idx on public.wa_crawl_jobs(client_id, created_at desc);

-- ============================================================ CONVERSATIONS / MESSAGES
create table if not exists public.wa_conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  channel text not null default 'web', -- web | standalone | telegram | whatsapp | instagram | messenger | email
  external_id text,            -- telegram chat id / whatsapp wa_id / ...
  status text not null default 'open', -- open | resolved | escalated | human
  escalation_reason text,
  visitor_id text,
  visitor_label text,
  page_url text,
  lead_name text,
  lead_email text,
  lead_phone text,
  last_message text,
  message_count int not null default 0,
  language text
);
create index if not exists wa_conversations_client_idx on public.wa_conversations(client_id, created_at desc);
create index if not exists wa_conversations_status_idx on public.wa_conversations(status);
create index if not exists wa_conversations_external_idx on public.wa_conversations(client_id, channel, external_id);

create table if not exists public.wa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.wa_conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null, -- user | assistant | human
  content text not null,
  sources jsonb,       -- [{url, anchor, title, heading_path, score}]
  no_answer boolean not null default false, -- set on the USER message when the bot had no confident answer
  feedback smallint,   -- 1 | -1
  model text,
  tokens_in int,
  tokens_out int
);
create index if not exists wa_messages_conv_idx on public.wa_messages(conversation_id, created_at);

-- keep conversation summary fields in sync
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

-- ============================================================ LEADS
create table if not exists public.wa_leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  conversation_id uuid references public.wa_conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  name text, email text, phone text, channel text
);
create index if not exists wa_leads_client_idx on public.wa_leads(client_id, created_at desc);

-- ============================================================ REPORTS
create table if not exists public.wa_reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  period_start date not null,
  period_end date not null,
  subject text,
  body_md text,
  stats jsonb,
  recipients text[] not null default '{}',
  status text not null default 'draft', -- draft | approved | sent | error
  sent_at timestamptz,
  error text
);
create index if not exists wa_reports_client_idx on public.wa_reports(client_id, created_at desc);

-- ============================================================ RATE LIMIT (per visitor / hour)
create table if not exists public.wa_rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- ============================================================ RPC: vector search
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

-- ============================================================ RPC: rate limit check (returns true if allowed)
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

-- ============================================================ VIEW: stats per client (dashboard)
-- security_invoker: la vista rispetta le RLS delle tabelle sottostanti (solo admin)
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

-- ============================================================ updated_at
create or replace function public.wa_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists wa_clients_touch on public.wa_clients;
create trigger wa_clients_touch before update on public.wa_clients for each row execute function public.wa_touch_updated_at();

-- ============================================================ ADMINS
-- Solo gli utenti in wa_admins accedono ai dati di WISI Assistant. Gli altri utenti di auth.users
-- (che appartengono ad altre app del DB condiviso) non vedono nulla.
create table if not exists public.wa_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.wa_admins enable row level security; -- nessuna policy: si legge solo via wa_is_admin() o service role

create or replace function public.wa_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wa_admins where user_id = auth.uid());
$$;
revoke execute on function public.wa_is_admin() from public, anon;
grant execute on function public.wa_is_admin() to authenticated, service_role;

do $$ begin
  insert into public.wa_admins (user_id)
  select id from auth.users where lower(email) = 'lorewhiskey@gmail.com'
  on conflict (user_id) do nothing;
  if not exists (select 1 from public.wa_admins a join auth.users u on u.id = a.user_id where lower(u.email) = 'lorewhiskey@gmail.com') then
    raise notice 'wa_admins: utente lorewhiskey@gmail.com non trovato in auth.users — crealo e riesegui questa migration';
  end if;
end $$;

-- RPC usate solo dalle edge functions (service role): niente accesso anonimo
revoke execute on function public.wa_match_chunks(uuid, vector, int, float) from public, anon;
revoke execute on function public.wa_check_rate_limit(text, int) from public, anon;

-- ============================================================ RLS
-- Accesso completo solo agli admin (wa_is_admin()). Public (anon) has NO direct table access:
-- the widget / standalone page / channels go only through the edge functions (service role).
alter table public.wa_clients enable row level security;
alter table public.wa_pages enable row level security;
alter table public.wa_chunks enable row level security;
alter table public.wa_crawl_jobs enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages enable row level security;
alter table public.wa_leads enable row level security;
alter table public.wa_reports enable row level security;
alter table public.wa_rate_limits enable row level security;

do $$
declare t text;
begin
  foreach t in array array['wa_clients','wa_pages','wa_chunks','wa_crawl_jobs','wa_conversations','wa_messages','wa_leads','wa_reports','wa_rate_limits'] loop
    execute format('drop policy if exists wa_admin_all on public.%I', t);
    execute format('create policy wa_admin_all on public.%I for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin())', t);
  end loop;
end $$;

-- ============================================================ REALTIME
do $$ begin
  alter publication supabase_realtime add table public.wa_clients;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.wa_pages;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.wa_crawl_jobs;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.wa_conversations;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.wa_messages;
exception when others then null; end $$;

-- ============================================================ STORAGE (wa-documents bucket, private)
insert into storage.buckets (id, name, public) values ('wa-documents', 'wa-documents', false) on conflict (id) do nothing;
drop policy if exists wa_documents_admin on storage.objects;
create policy wa_documents_admin on storage.objects for all to authenticated
  using (bucket_id = 'wa-documents' and public.wa_is_admin())
  with check (bucket_id = 'wa-documents' and public.wa_is_admin());
