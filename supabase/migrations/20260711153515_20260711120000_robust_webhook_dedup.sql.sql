-- Reestrutura a tabela de dedup de webhook para suportar dois modos:
-- 1) Por message_id (chave primaria, como antes)
-- 2) Por telefone + conteudo + janela de tempo (15s) — cobre reenvios com IDs diferentes

DROP TABLE IF EXISTS webhook_events_processados;

CREATE TABLE webhook_events_processados (
  message_id TEXT PRIMARY KEY,
  telefone TEXT,
  conteudo TEXT,
  processado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indice para lookup rapido por telefone+conteudo dentro de uma janela de tempo
CREATE INDEX idx_webhook_dedup_phone_content
  ON webhook_events_processados (telefone, conteudo, processado_em);

-- Habilita RLS (tabela de controle interno, sem acesso direto do client)
ALTER TABLE webhook_events_processados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all_webhook_dedup" ON webhook_events_processados
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);