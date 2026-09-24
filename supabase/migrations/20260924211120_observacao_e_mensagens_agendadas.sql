/*
  Duas features novas:

  1. Observacao por contato: um campo de texto livre em "contacts" pra
     deixar um lembrete/nota sobre o contato (ex: "vai pagar dia 30/09"),
     visivel e filtravel na lista geral do WhatsApp.

  2. Mensagens agendadas: permite programar o envio automatico de uma
     mensagem de texto pra um contato especifico, numa data/hora futura
     escolhida manualmente. Uma Edge Function (enviar-mensagens-agendadas)
     roda periodicamente (via cron externo, do mesmo jeito que ja e feito
     hoje para o campaign-followup) e envia as mensagens que estao dentro
     do prazo.
*/

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS observacao text;

CREATE TABLE IF NOT EXISTS mensagens_agendadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  conteudo text NOT NULL,
  enviar_em timestamptz NOT NULL,
  enviado boolean NOT NULL DEFAULT false,
  erro text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mensagens_agendadas_pendentes
  ON mensagens_agendadas (enviar_em)
  WHERE enviado = false;

ALTER TABLE mensagens_agendadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_mensagens_agendadas" ON mensagens_agendadas;
CREATE POLICY "select_mensagens_agendadas" ON mensagens_agendadas FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "insert_mensagens_agendadas" ON mensagens_agendadas;
CREATE POLICY "insert_mensagens_agendadas" ON mensagens_agendadas FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "update_mensagens_agendadas" ON mensagens_agendadas;
CREATE POLICY "update_mensagens_agendadas" ON mensagens_agendadas FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "delete_mensagens_agendadas" ON mensagens_agendadas;
CREATE POLICY "delete_mensagens_agendadas" ON mensagens_agendadas FOR DELETE
  USING (true);
