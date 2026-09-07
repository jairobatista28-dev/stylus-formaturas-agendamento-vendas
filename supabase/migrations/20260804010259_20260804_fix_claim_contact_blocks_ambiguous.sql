-- Fix ambiguous column reference in claim_contact_blocks
-- The RETURNING clause referenced unqualified column names which conflicted with the function's output columns
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

  RETURN QUERY
  UPDATE fila_envios fe
  SET status = 'processando'
  WHERE fe.contato_id = v_contato_id AND fe.status = 'pendente'
  RETURNING fe.id, fe.contato_id, fe.campanha_id,
            fe.telefone, fe.mensagem, fe.ordem_bloco,
            fe.delay_bloco, fe.status;
END;
$$;

GRANT EXECUTE ON FUNCTION claim_contact_blocks TO authenticated, anon;
