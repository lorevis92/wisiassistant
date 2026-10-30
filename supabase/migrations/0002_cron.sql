-- Report periodici: ogni giorno alle 06:00 UTC chiama la edge function generate-report in modalità "scheduled".
-- La function decide per quali clienti è il momento (weekly=lunedì, biweekly=ogni 2 lunedì, monthly=1° del mese)
-- e crea la bozza (o invia direttamente se report_auto_send = true).
--
-- PRIMA di eseguire: sostituisci <PROJECT_REF> e <SERVICE_ROLE_KEY>.
-- (Supabase → Project Settings → API). In alternativa salva la chiave in Vault e leggila da lì.
--
-- DB condiviso: i job hanno prefisso wa_ e vengono rimossi/ricreati solo quelli; i job delle altre app non vengono toccati.

select cron.unschedule('wa_reports') where exists (select 1 from cron.job where jobname = 'wa_reports');

select cron.schedule(
  'wa_reports',
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
select cron.unschedule('wa_ratelimit_cleanup') where exists (select 1 from cron.job where jobname = 'wa_ratelimit_cleanup');
select cron.schedule('wa_ratelimit_cleanup', '15 3 * * *', $$ delete from public.wa_rate_limits where window_start < now() - interval '2 hours'; $$);
