-- =====================================================================================================================
-- Sardesk — 0010: CRAWL PIÙ ROBUSTO. Idempotente, non cancella dati.
--
--  - wa_pages.last_error / last_failed_at: l'ultimo tentativo fallito di una pagina già indicizzata. Il contenuto e i
--    frammenti restano attivi; la pagina mostra "Ultimo tentativo fallito" con il motivo. Si azzera al successo.
--  - wa_clients.crawl_rps: richieste al secondo verso il sito del cliente durante il crawl (default 1, da 0.1 a 10).
-- Il crawler funziona anche senza questa migrazione (scrive il motivo nel campo error), ma senza i due campi una
-- pagina fallita non si distingue bene da una pagina con contenuto.
-- =====================================================================================================================

alter table public.wa_pages add column if not exists last_error text;
alter table public.wa_pages add column if not exists last_failed_at timestamptz;

alter table public.wa_clients add column if not exists crawl_rps numeric not null default 1;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wa_clients_crawl_rps_range') then
    alter table public.wa_clients add constraint wa_clients_crawl_rps_range check (crawl_rps >= 0.1 and crawl_rps <= 10);
  end if;
end $$;

-- pagine segnate "failed" in passato ma che hanno ancora frammenti: tornano "ok" con il motivo come ultimo tentativo
update public.wa_pages
   set status = 'ok', last_error = coalesce(last_error, error), last_failed_at = coalesce(last_failed_at, last_crawled_at), error = null
 where kind = 'page' and status = 'failed' and chunk_count > 0;

notify pgrst, 'reload schema';
