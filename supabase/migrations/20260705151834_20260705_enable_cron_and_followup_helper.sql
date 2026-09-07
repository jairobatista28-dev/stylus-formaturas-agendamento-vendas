-- Enable pg_cron extension (for scheduled jobs)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension (for HTTP requests)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- IMPORTANTE: O agendamento do cron para chamar a Edge Function campaign-followup
-- deve ser configurado MANUALMENTE via Supabase Dashboard > Database > Cron
-- ou usando uma ferramenta externa como cron-job.org
--
-- Motivo: Não é seguro expor a SERVICE_ROLE_KEY diretamente na migration SQL.
--
-- Opção 1 - Configurar via Supabase Dashboard:
--   1. Vá em Database > Cron Jobs
--   2. Crie novo job com schedule: '0 * * * *' (a cada hora)
--   3. Use o comando:
--      SELECT net.http_post(
--        url := 'https://ID_DO_PROJETO.supabase.co/functions/v1/campaign-followup',
--        headers := '{"Content-Type": "application/json", "Authorization": "Bearer SUA_SERVICE_ROLE_KEY"}'::jsonb,
--        body := '{}'::jsonb
--      );
--
-- Opção 2 - Usar cron-job.org (gratuito):
--   1. Crie conta em cron-job.org
--   2. Adicione URL: https://ID_DO_PROJETO.supabase.co/functions/v1/campaign-followup
--   3. Schedule: a cada 1 hora
--   4. Method: POST
--   5. Headers: Content-Type: application/json
--   6. Body: {}
--
-- ============================================================================

-- Create a helper function to check contacts needing follow-up (for debugging)
CREATE OR REPLACE FUNCTION get_contacts_needing_followup()
RETURNS TABLE (
  id uuid,
  nome text,
  telefone text,
  status text,
  horas_desde_criacao numeric
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cc.id,
    cc.nome,
    cc.telefone,
    cc.status,
    EXTRACT(EPOCH FROM (now() - cc.criado_em)) / 3600 as horas_desde_criacao
  FROM contatos_campanha cc
  WHERE cc.status = 'saudacao_enviada'
    AND cc.follow_up_enviado = false
    AND cc.criado_em < now() - interval '24 hours'
  ORDER BY cc.criado_em ASC;
END;
$$;