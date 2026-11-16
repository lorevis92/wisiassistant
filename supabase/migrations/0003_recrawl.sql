-- Re-crawl automatico dei siti dei clienti.
-- Idempotente. DB condiviso: tocca solo oggetti con prefisso wa_.
--
-- Ogni cliente ha una frequenza (none | daily | weekly | monthly) impostabile in Impostazioni → Crawling.
-- Ogni giorno alle 02:30 UTC pg_cron chiama il crawler (POST /recrawl/scheduled): il crawler decide quali clienti
-- sono da aggiornare, rimappa il sito, applica le regole include/exclude, indicizza le pagine nuove, ri-embedda solo
-- quelle cambiate (content_hash) e disattiva quelle sparite (status 'gone'). Documenti, FAQ e testi manuali
-- (kind <> 'page') non vengono mai toccati.
--
-- PRIMA di eseguire la parte cron: sostituisci <CRAWLER_URL> (es. https://wisi-crawler.up.railway.app)
-- e <CRAWLER_SECRET> (lo stesso valore della variabile CRAWLER_SECRET del servizio crawler su Railway).

-- ------------------------------------------------------------ clients: frequenza ed esito ultimo re-crawl
alter table public.wa_clients add column if not exists recrawl_frequency text not null default 'none'; -- none | daily | weekly | monthly
alter table public.wa_clients add column if not exists last_recrawl_at timestamptz;
alter table public.wa_clients add column if not exists last_recrawl_status text;   -- running | done | error | skipped
alter table public.wa_clients add column if not exists last_recrawl_error text;
alter table public.wa_clients add column if not exists last_recrawl_job_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'wa_clients_recrawl_frequency_chk') then
    alter table public.wa_clients add constraint wa_clients_recrawl_frequency_chk
      check (recrawl_frequency in ('none', 'daily', 'weekly', 'monthly'));
  end if;
end $$;

-- ------------------------------------------------------------ crawl jobs: storico esecuzioni con esito
alter table public.wa_crawl_jobs add column if not exists trigger text not null default 'manual'; -- manual | scheduled | manual_recrawl
alter table public.wa_crawl_jobs add column if not exists mapped_count int;
alter table public.wa_crawl_jobs add column if not exists new_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists updated_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists unchanged_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists removed_count int not null default 0;
alter table public.wa_crawl_jobs add column if not exists summary text;
-- status ora può valere anche: mapping | skipped

-- ------------------------------------------------------------ cron giornaliero
select cron.unschedule('wa_recrawl') where exists (select 1 from cron.job where jobname = 'wa_recrawl');

select cron.schedule(
  'wa_recrawl',
  '30 2 * * *',
  $$
  select net.http_post(
    url := '<CRAWLER_URL>/recrawl/scheduled',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <CRAWLER_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
