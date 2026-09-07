/*
# Add sale tracking fields and sale notifications table

1. New Columns on `contatos_campanha`
- `valor_tabela` (numeric(10,2)) — table price reference for the contact
- `valor_oferecido` (numeric(10,2)) — offered price to the contact
- `formas_pagamento` (text) — payment methods offered
- `opcoes_plano` (text) — plan options offered
- `prazo_reciclagem` (text) — recycling/re-engagement timeframe

2. New Table: `notificacoes_venda`
- `id` (uuid, primary key)
- `contato_campanha_id` (uuid, FK to contatos_campanha, cascade delete)
- `campanha_id` (uuid, FK to campanhas, cascade delete)
- `mensagem_enviada` (text, not null) — the sale notification message sent
- `enviado_em` (timestamptz, default now)
- `visualizado` (boolean, default false) — whether the notification was viewed

3. Indexes
- `idx_notificacoes_venda_campanha` on `notificacoes_venda(campanha_id)`
- `idx_notificacoes_venda_contato` on `notificacoes_venda(contato_campanha_id)`

4. Security (RLS on `notificacoes_venda`)
- SELECT: authenticated users can read all rows
- INSERT: authenticated + anon can insert (webhooks/edge functions use anon key)
- UPDATE: authenticated users can update (e.g. mark as visualizado)
- No DELETE policy (notifications are retained)

5. Notes
- All statements use IF NOT EXISTS / DROP POLICY IF EXISTS for idempotency.
- No existing columns or tables are altered or removed.
*/

ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS valor_tabela numeric(10,2);
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS valor_oferecido numeric(10,2);
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS formas_pagamento text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS opcoes_plano text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS prazo_reciclagem text;

CREATE TABLE IF NOT EXISTS notificacoes_venda (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_campanha_id uuid REFERENCES contatos_campanha(id) ON DELETE CASCADE,
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  mensagem_enviada text NOT NULL,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  visualizado boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_notificacoes_venda_campanha ON notificacoes_venda(campanha_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_venda_contato ON notificacoes_venda(contato_campanha_id);

ALTER TABLE notificacoes_venda ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_notificacoes_venda" ON notificacoes_venda;
CREATE POLICY "select_notificacoes_venda" ON notificacoes_venda FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_notificacoes_venda" ON notificacoes_venda;
CREATE POLICY "insert_notificacoes_venda" ON notificacoes_venda FOR INSERT
  TO authenticated, anon WITH CHECK (true);

DROP POLICY IF EXISTS "update_notificacoes_venda" ON notificacoes_venda;
CREATE POLICY "update_notificacoes_venda" ON notificacoes_venda FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);
