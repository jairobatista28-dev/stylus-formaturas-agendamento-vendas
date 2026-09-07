-- Schedule cron job to run campaign-dispatcher every minute
-- This processes the fila_envios queue and respects the delay_bloco field

SELECT cron.schedule(
  'campaign-dispatcher-minute',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://jnusnsktoddihfoizlpr.supabase.co/functions/v1/campaign-dispatcher',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);