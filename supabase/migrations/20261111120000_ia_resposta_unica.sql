-- IA: uma resposta so por mensagem (ou por rajada de mensagens)
-- Buffer usado pelo uazapi-webhook para juntar mensagens seguidas do formando
-- e chamar a IA uma unica vez.

CREATE TABLE IF NOT EXISTS ia_buffer_mensagens (
  id BIGSERIAL PRIMARY KEY,
  telefone TEXT NOT NULL,
  texto TEXT NOT NULL,
  processado BOOLEAN NOT NULL DEFAULT false,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ia_buffer_telefone_pendente
  ON ia_buffer_mensagens (telefone, processado, id);

ALTER TABLE ia_buffer_mensagens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_ia_buffer" ON ia_buffer_mensagens;
CREATE POLICY "service_role_all_ia_buffer" ON ia_buffer_mensagens
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

-- Limpeza diaria: apaga buffer e registros de dedup com mais de 3 dias
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.unschedule('limpa_buffer_ia') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'limpa_buffer_ia');
SELECT cron.schedule(
  'limpa_buffer_ia',
  '15 3 * * *',
  $$DELETE FROM ia_buffer_mensagens WHERE criado_em < now() - interval '3 days';
    DELETE FROM webhook_events_processados WHERE processado_em < now() - interval '3 days';$$
);
