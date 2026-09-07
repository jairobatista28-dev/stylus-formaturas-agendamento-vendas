/*
# Add revisao_humana flag for appointment validation

1. New Columns
- `contatos_campanha.revisao_humana` (boolean, default false) — flagged when
  the AI tries to confirm an appointment but the formando didn't explicitly
  mention the date/turno in their messages.
- `contacts.revisao_humana` (boolean, default false) — same flag for the
  default (non-campaign) AI flow.

2. Purpose
- When the server-side validation blocks an ###AGENDAMENTO_CONFIRMADO### marker
  because the date or turno wasn't found in the formando's messages, the
  conversation is flagged for human review instead of silently recovering.
- The operator can then check the flagged conversations in the dashboard.

3. Security
- No RLS changes needed — existing policies already cover the new columns.
*/

ALTER TABLE contatos_campanha
  ADD COLUMN IF NOT EXISTS revisao_humana boolean NOT NULL DEFAULT false;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS revisao_humana boolean NOT NULL DEFAULT false;
