-- Report periodici: ogni giorno alle 06:00 UTC chiama la edge function generate-report in modalità "scheduled".
-- La function decide per quali clienti è il momento (weekly=lunedì, biweekly=ogni 2 lunedì, monthly=1° del mese)
-- e crea la bozza (o invia direttamente se report_auto_send = true).
--
-- PRIMA di eseguire: sostituisci <PROJECT_REF> e <SERVICE_ROLE_KEY>.
-- (Supabase → Project Settings → API). In alternativa salva la chiave in Vault e leggila da lì.

select cron.unschedule('wisi-assistant-reports') where exists (select 1 from cron.job where jobname = 'wisi-assistant-reports');

select cron.schedule(
  'wisi-assistant-reports',
  '0 6 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer <SERVICE_ROLE_KEY>'),
    body := jsonb_build_object('mode', 'scheduled')
  );
  $$
);

-- Pulizia rate limit vecchi (ogni notte)
select cron.unschedule('wisi-assistant-ratelimit-cleanup') where exists (select 1 from cron.job where jobname = 'wisi-assistant-ratelimit-cleanup');
select cron.schedule('wisi-assistant-ratelimit-cleanup', '15 3 * * *', $$ delete from public.rate_limits where window_start < now() - interval '2 hours'; $$);
