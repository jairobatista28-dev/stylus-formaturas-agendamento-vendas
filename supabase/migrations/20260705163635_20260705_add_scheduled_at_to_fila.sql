-- Add scheduled_at column to fila_envios for timed delivery
ALTER TABLE fila_envios ADD COLUMN IF NOT EXISTS agendado_para timestamp with time zone;

-- Create index for faster lookup of scheduled messages
CREATE INDEX IF NOT EXISTS idx_fila_envios_agendado ON fila_envios(agendado_para) WHERE status = 'pendente';

-- Function to check how many pending items exist for a contact
CREATE OR REPLACE FUNCTION get_pending_blocks_count(p_contato_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  cnt integer;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM fila_envios
  WHERE contato_id = p_contato_id AND status = 'pendente';
  RETURN cnt;
END;
$$;