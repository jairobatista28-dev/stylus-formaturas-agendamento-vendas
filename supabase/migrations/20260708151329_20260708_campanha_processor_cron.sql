-- Schedule cron job to run campanha-processor every minute for state machine
-- This checks for conversations waiting for time delays

SELECT cron.schedule(
  'campanha-processor-cron',
  '* * * * *',  -- Every minute
  $$
  SELECT net.http_post(
    url := 'https://jnusnsktoddihfoizlpr.supabase.co/functions/v1/campanha-processor',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"acao": "processar_cron"}'::jsonb
  );
  $$
);