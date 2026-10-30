-- WISI Assistant — schema iniziale
-- Eseguire in Supabase → SQL Editor (oppure `supabase db push`). Idempotente.

create extension if not exists vector;
create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ============================================================ CLIENTS
create table if not exists public.clients (
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
create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
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
create index if not exists pages_client_idx on public.pages(client_id);

-- ============================================================ CHUNKS (pgvector)
create table if not exists public.chunks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  idx int not null,
  content text not null,
  url text not null,           -- page URL
  anchor text,                 -- #section-id when available → url#anchor
  heading_path text,           -- "H1 > H2 > H3"
  title text,
  embedding vector(1536),
  token_count int
);
create index if not exists chunks_client_idx on public.chunks(client_id);
create index if not exists chunks_page_idx on public.chunks(page_id);
-- HNSW works well up to millions of rows; cosine distance
create index if not exists chunks_embedding_idx on public.chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================ CRAWL JOBS
create table if not exists public.crawl_jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
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
create index if not exists crawl_jobs_client_idx on public.crawl_jobs(client_id, created_at desc);

-- ============================================================ CONVERSATIONS / MESSAGES
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
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
create index if not exists conversations_client_idx on public.conversations(client_id, created_at desc);
create index if not exists conversations_status_idx on public.conversations(status);
create index if not exists conversations_external_idx on public.conversations(client_id, channel, external_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
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
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- keep conversation summary fields in sync
create or replace function public.on_message_insert() returns trigger language plpgsql as $$
begin
  update public.conversations
     set last_message = left(new.content, 200),
         message_count = message_count + 1,
         updated_at = now()
   where id = new.conversation_id;
  return new;
end $$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert after insert on public.messages for each row execute function public.on_message_insert();

-- ============================================================ LEADS
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  created_at timestamptz not null default now(),
  name text, email text, phone text, channel text
);
create index if not exists leads_client_idx on public.leads(client_id, created_at desc);

-- ============================================================ REPORTS
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
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
create index if not exists reports_client_idx on public.reports(client_id, created_at desc);

-- ============================================================ RATE LIMIT (per visitor / hour)
create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- ============================================================ RPC: vector search
create or replace function public.match_chunks(
  p_client_id uuid,
  p_embedding vector(1536),
  p_match_count int default 8,
  p_min_similarity float default 0.0
) returns table (
  id uuid, page_id uuid, content text, url text, anchor text, heading_path text, title text, similarity float
) language sql stable as $$
  select c.id, c.page_id, c.content, c.url, c.anchor, c.heading_path, c.title,
         1 - (c.embedding <=> p_embedding) as similarity
    from public.chunks c
    join public.pages p on p.id = c.page_id
   where c.client_id = p_client_id
     and p.enabled = true
     and 1 - (c.embedding <=> p_embedding) >= p_min_similarity
   order by c.embedding <=> p_embedding
   limit p_match_count;
$$;

-- ============================================================ RPC: rate limit check (returns true if allowed)
create or replace function public.check_rate_limit(p_key text, p_limit int) returns boolean language plpgsql as $$
declare r record;
begin
  select * into r from public.rate_limits where key = p_key for update;
  if not found then
    insert into public.rate_limits(key, window_start, count) values (p_key, now(), 1);
    return true;
  end if;
  if r.window_start < now() - interval '1 hour' then
    update public.rate_limits set window_start = now(), count = 1 where key = p_key;
    return true;
  end if;
  if r.count >= p_limit then return false; end if;
  update public.rate_limits set count = count + 1 where key = p_key;
  return true;
end $$;

-- ============================================================ VIEW: stats per client (dashboard)
create or replace view public.client_stats as
select c.id as client_id,
  (select count(*) from public.pages p where p.client_id = c.id and p.status = 'ok' and p.enabled) as pages_indexed,
  (select coalesce(sum(p.chunk_count),0) from public.pages p where p.client_id = c.id and p.enabled) as chunks,
  (select count(*) from public.conversations v where v.client_id = c.id and v.created_at > now() - interval '30 days') as conversations_30d,
  (select count(*) from public.messages m join public.conversations v on v.id = m.conversation_id where v.client_id = c.id and m.created_at > now() - interval '30 days') as messages_30d,
  (select count(*) from public.conversations v where v.client_id = c.id and v.status in ('escalated','human')) as open_escalations,
  (select count(*) from public.leads l where l.client_id = c.id) as leads,
  (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where v.status not in ('escalated','human')) / count(*)) end
     from public.conversations v where v.client_id = c.id and v.created_at > now() - interval '30 days') as resolution_rate
from public.clients c;

-- ============================================================ updated_at
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();

-- ============================================================ RLS
-- Single-admin model: any authenticated user (= you) has full access. Public (anon) has NO direct table access:
-- the widget / standalone page / channels go only through the edge functions (service role).
alter table public.clients enable row level security;
alter table public.pages enable row level security;
alter table public.chunks enable row level security;
alter table public.crawl_jobs enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.leads enable row level security;
alter table public.reports enable row level security;
alter table public.rate_limits enable row level security;

do $$
declare t text;
begin
  foreach t in array array['clients','pages','chunks','crawl_jobs','conversations','messages','leads','reports','rate_limits'] loop
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ============================================================ REALTIME
do $$ begin
  alter publication supabase_realtime add table public.clients;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.pages;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.crawl_jobs;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when others then null; end $$;

-- ============================================================ STORAGE (documents bucket, private)
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
drop policy if exists documents_admin on storage.objects;
create policy documents_admin on storage.objects for all to authenticated using (bucket_id = 'documents') with check (bucket_id = 'documents');
