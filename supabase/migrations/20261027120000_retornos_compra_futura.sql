/*
# Retorno programado (formando que promete comprar em outra data)

- retornos_agendados: na data combinada a IA chama o formando de volta.
  * origem: 'ia' (a IA registrou na conversa), 'manual' (agendado pelo painel)
    ou 'ia_detectada' (a IA encontrou a promessa lendo a conversa e voce confirmou)
  * excecao = true quando a data passa do prazo de guarda do material; a
    supervisao pode recusar no painel (sem recusa, vale como aprovada)
- contatos_campanha.status ganha o valor 'compra_futura' (coluna e text livre)
- resgate_config.retornos_ativos: liga/desliga os retornos (padrao: ligado)

A Edge Function resgate-vendas (cron de 10 em 10 min, ja agendado) tambem
processa os retornos. Idempotente.
*/

ALTER TABLE resgate_config ADD COLUMN IF NOT EXISTS retornos_ativos boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS retornos_agendados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_campanha_id uuid REFERENCES contatos_campanha(id) ON DELETE CASCADE,
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  nome text,
  telefone text NOT NULL,
  data_retorno date NOT NULL,
  agendado_para timestamptz NOT NULL,
  prazo_limite date,
  excecao boolean NOT NULL DEFAULT false,
  excecao_status text NOT NULL DEFAULT 'nao_aplica'
    CHECK (excecao_status IN ('nao_aplica', 'solicitada', 'aprovada', 'recusada')),
  origem text NOT NULL DEFAULT 'ia' CHECK (origem IN ('ia', 'manual', 'ia_detectada')),
  trecho text,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado', 'enviado', 'cancelado', 'erro')),
  motivo text,
  mensagem text,
  enviado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_retorno_contato_agendado
  ON retornos_agendados (contato_campanha_id) WHERE status = 'agendado';
CREATE INDEX IF NOT EXISTS idx_retornos_pendentes
  ON retornos_agendados (agendado_para) WHERE status = 'agendado';

ALTER TABLE retornos_agendados ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_retornos" ON retornos_agendados;
CREATE POLICY "select_retornos" ON retornos_agendados FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "update_retornos" ON retornos_agendados;
CREATE POLICY "update_retornos" ON retornos_agendados FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
