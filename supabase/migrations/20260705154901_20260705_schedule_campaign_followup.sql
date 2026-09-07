-- Schedule cron job to run campaign-followup every hour
-- Note: The Edge Function campaign-followup has verify_jwt=false, so it accepts anonymous calls

SELECT cron.schedule(
  'campaign-followup-hourly',
  '0 * * * *',  -- Every hour at minute 0
  $$
  SELECT net.http_post(
    url := 'https://jnusnsktoddihfoizlpr.supabase.co/functions/v1/campaign-followup',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Create helper function to check cron job status
CREATE OR REPLACE FUNCTION get_cron_jobs()
RETURNS TABLE (
  jobid bigint,
  schedule text,
  command text,
  nodename text,
  nodeport integer,
  database text,
  username text,
  active boolean,
  jobname text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY SELECT * FROM cron.job;
END;
$$;