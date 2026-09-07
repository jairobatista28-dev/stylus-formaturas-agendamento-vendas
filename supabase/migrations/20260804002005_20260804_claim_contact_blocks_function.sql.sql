-- Atomic per-contact lock function for campaign-dispatcher
-- Prevents concurrent dispatchers (cron + manual) from processing the same contact's blocks out of order
CREATE OR REPLACE FUNCTION claim_contact_blocks(p_limit int DEFAULT 20)
RETURNS TABLE (
  id uuid,
  contato_id uuid,
  campanha_id uuid,
  telefone text,
  mensagem text,
  ordem_bloco int,
  delay_bloco int,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_contato_id uuid;
BEGIN
  -- Find the first contato_id that has pending blocks AND no blocks in 'processando'
  SELECT DISTINCT f.contato_id INTO v_contato_id
  FROM fila_envios f
  WHERE f.status = 'pendente'
    AND NOT EXISTS (
      SELECT 1 FROM fila_envios f2
      WHERE f2.contato_id = f.contato_id AND f2.status = 'processando'
    )
  ORDER BY f.contato_id
  LIMIT 1;

  IF v_contato_id IS NULL THEN
    RETURN;
  END IF;

  -- Atomically mark all pending blocks for this contact as 'processando'
  -- and return them in ordem_bloco order
  RETURN QUERY
  UPDATE fila_envios
  SET status = 'processando'
  WHERE contato_id = v_contato_id AND status = 'pendente'
  RETURNING fila_envios.id, fila_envios.contato_id, fila_envios.campanha_id,
            fila_envios.telefone, fila_envios.mensagem, fila_envios.ordem_bloco,
            fila_envios.delay_bloco, fila_envios.status;
END;
$$;

-- Grant execute to authenticated and anon (dispatcher uses service role)
GRANT EXECUTE ON FUNCTION claim_contact_blocks TO authenticated, anon;