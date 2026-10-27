/*
# Agendamentos sem falha

As colunas appointments.campaign_id e appointments.campaign_contact_id nasceram
apontando para as tabelas antigas (campaigns / campaign_contacts). O sistema hoje
grava nelas os IDs de campanhas / contatos_campanha, entao o banco recusava o
insert e o formando agendado nao aparecia na lista de agendamentos nem ganhava
a marcacao AG no chat.

Remove essas chaves estrangeiras antigas (as colunas e os dados continuam).
Idempotente: pode rodar mais de uma vez.
*/

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE rel.relname = 'appointments'
      AND con.contype = 'f'
      AND ref.relname IN ('campaigns', 'campaign_contacts')
  LOOP
    EXECUTE format('ALTER TABLE appointments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_contact_id ON appointments (contact_id);
