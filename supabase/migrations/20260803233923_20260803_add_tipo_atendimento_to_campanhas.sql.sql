-- Add tipo_atendimento column to campanhas (defaults to visita_externa for existing campaigns)
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS tipo_atendimento text DEFAULT 'visita_externa';