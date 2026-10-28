/*
# Painel de Alertas

Registra o que a IA e as rotinas automaticas fizeram de importante, para o
painel mostrar sem depender dos logs do Supabase:
- trava_escolha: IA tentou registrar uma opcao que o formando nao escolheu
- foto_falhou: foto do formando nao enviada (com o motivo)
- audio_falhou: audio do formando nao transcrito
- agendamento_conferir: agendamento registrado com data/turno a conferir
- ia_sem_resposta: Gemini nao respondeu
- venda_pronta: dados conferidos, enviar link de pagamento
- comprovante: comprovante de pagamento recebido

Idempotente.
*/

CREATE TABLE IF NOT EXISTS alertas_sistema (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  gravidade text NOT NULL DEFAULT 'info' CHECK (gravidade IN ('info', 'atencao', 'erro')),
  titulo text NOT NULL,
  detalhe text,
  contato_nome text,
  telefone text,
  lido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alertas_sistema_criado_em ON alertas_sistema (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_alertas_sistema_nao_lidos ON alertas_sistema (lido) WHERE lido = false;

ALTER TABLE alertas_sistema ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "alertas_select" ON alertas_sistema FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "alertas_update" ON alertas_sistema FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "alertas_delete" ON alertas_sistema FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Tempo real (o contador de alertas no menu atualiza sozinho)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE alertas_sistema;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- Indices que aceleram o Funil de Vendas e a lista de conversas
CREATE INDEX IF NOT EXISTS idx_contatos_campanha_telefone ON contatos_campanha (telefone);
CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON messages (contact_id, created_at DESC);
