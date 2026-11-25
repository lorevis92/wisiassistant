-- =====================================================================================================================
-- Sardesk — 0009: RECUPERO DEI CONTENUTI (ricerca ibrida), "Perché ha risposto così", domande di prova.
-- Richiede 0006. Idempotente, non cancella dati.
--
--  - wa_chunks.fts: indice per parole chiave (titolo pagina + sezione + testo), configurazione 'simple' (multilingua)
--  - wa_hybrid_search(): ricerca semantica (embedding) + per parole chiave, fuse con Reciprocal Rank Fusion.
--    Nessuna soglia che scarta frammenti: decide il punteggio, il modello vede i migliori.
--  - wa_messages.retrieval: per ogni risposta, domanda usata per la ricerca, frammenti e pagine recuperati con i
--    punteggi (vista "Perché ha risposto così")
--  - wa_eval_questions: domande di prova per cliente, con le informazioni attese e l'ultimo esito
-- =====================================================================================================================

-- ------------------------------------------------------------------------------ indice per parole chiave
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'wa_chunks' and column_name = 'fts') then
    alter table public.wa_chunks add column fts tsvector
      generated always as (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(heading_path, '') || ' ' || coalesce(content, ''))) stored;
  end if;
end $$;
create index if not exists wa_chunks_fts_idx on public.wa_chunks using gin (fts);

-- domanda → tsquery in OR, parole ≥ 3 lettere senza le più comuni, con prefisso (prezzo/prezzi, orario/orari…)
create or replace function public.wa_keyword_query(p_text text) returns tsquery
language plpgsql immutable set search_path = '' as $$
declare v text;
begin
  select string_agg(distinct case when length(w) >= 5 then left(w, greatest(4, length(w) - 2)) || ':*' else w end, ' | ')
    into v
  from regexp_split_to_table(lower(coalesce(p_text, '')), '[^[:alnum:]]+') w
  where length(w) >= 3
    and w not in ('che','per','con','una','uno','gli','del','della','delle','dei','degli','nel','nella','sono','come','cosa','quale','quali',
                  'quando','dove','perche','anche','alla','alle','agli','dal','dalla','non','più','piu','posso','potete','avete','vostro','vostra',
                  'the','and','for','you','are','what','how','can','with','your','der','die','das','und','ist','wie','was','les','des','est','une','pour','vous')
    and w !~ '^[0-9]{1,2}$';
  if v is null then return null; end if;
  return to_tsquery('simple', v);
exception when others then
  return null;
end $$;

-- ricerca ibrida: top-N semantico + top-N parole chiave, fusi con RRF (k = 60)
create or replace function public.wa_hybrid_search(
  p_client_id uuid,
  p_embedding vector(1536),
  p_query text,
  p_match_count int default 12
) returns table (
  id uuid, page_id uuid, idx int, content text, url text, anchor text, heading_path text, title text, kind text,
  similarity float, keyword_rank float, score float
) language sql stable set search_path = public, extensions as $$
  with q as (select public.wa_keyword_query(p_query) as tsq),
  vec as (
    select c.id, row_number() over (order by c.embedding <=> p_embedding) as r, 1 - (c.embedding <=> p_embedding) as sim
    from public.wa_chunks c join public.wa_pages p on p.id = c.page_id
    where c.client_id = p_client_id and p.enabled = true and c.embedding is not null
    order by c.embedding <=> p_embedding
    limit 40
  ),
  kw as (
    select c.id, row_number() over (order by ts_rank_cd(c.fts, q.tsq) desc) as r, ts_rank_cd(c.fts, q.tsq) as kr
    from public.wa_chunks c join public.wa_pages p on p.id = c.page_id, q
    where c.client_id = p_client_id and p.enabled = true and q.tsq is not null and c.fts @@ q.tsq
    order by ts_rank_cd(c.fts, q.tsq) desc
    limit 40
  ),
  fused as (
    select coalesce(vec.id, kw.id) as id,
           coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + kw.r), 0) as score,
           vec.sim, kw.kr
    from vec full outer join kw on kw.id = vec.id
  )
  select c.id, c.page_id, c.idx, c.content, c.url, c.anchor, c.heading_path, c.title, p.kind,
         coalesce(f.sim, 1 - (c.embedding <=> p_embedding)) as similarity, coalesce(f.kr, 0) as keyword_rank, f.score
  from fused f join public.wa_chunks c on c.id = f.id join public.wa_pages p on p.id = c.page_id
  order by f.score desc
  limit p_match_count;
$$;
revoke execute on function public.wa_hybrid_search(uuid, vector, text, int) from public, anon, authenticated;
grant execute on function public.wa_hybrid_search(uuid, vector, text, int) to service_role;
revoke execute on function public.wa_keyword_query(text) from public, anon;
grant execute on function public.wa_keyword_query(text) to authenticated, service_role;

-- ------------------------------------------------------------------------------ "Perché ha risposto così"
alter table public.wa_messages add column if not exists retrieval jsonb;

-- ------------------------------------------------------------------------------ domande di prova
create table if not exists public.wa_eval_questions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.wa_clients(id) on delete cascade,
  question text not null,
  expected text,            -- informazioni che la risposta deve contenere (separate da virgola), facoltativo
  expected_url text,        -- pagina che dovrebbe essere linkata, facoltativo
  last_run_at timestamptz,
  last_answer text,
  last_pass boolean,
  last_details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists wa_eval_questions_client on public.wa_eval_questions (client_id);
alter table public.wa_eval_questions enable row level security;
drop policy if exists wa_client_access on public.wa_eval_questions;
create policy wa_client_access on public.wa_eval_questions for all to authenticated
  using (public.wa_can_access_client(client_id)) with check (public.wa_can_access_client(client_id));

notify pgrst, 'reload schema';
