/*
# Campanha "Black Friday" + carregamento mais rapido das telas

1. modalidade_venda ganha o valor 'black_friday' (venda direta, sem visita, 1 foto em
   visualizacao unica, desconto unico ate a data da Black). Usa o mesmo fluxo da
   "Ultima Oportunidade": conferencia de CPF/e-mail, repasse ao humano etc.
2. Resgate automatico (prorrogacao) ignora tambem as campanhas Black Friday.
3. resumo_campanhas(): a tela Campanhas busca so os numeros (total de contatos e
   erros de envio) numa unica consulta, em vez de baixar todos os contatos de
   todas as campanhas, uma por uma.
4. Indices para as consultas mais usadas pelas telas Campanhas e WhatsApp.

Idempotente (pode rodar mais de uma vez).
*/

-- 1. Nova modalidade ----------------------------------------------------------
ALTER TABLE campanhas DROP CONSTRAINT IF EXISTS campanhas_modalidade_venda_check;
ALTER TABLE campanhas
  ADD CONSTRAINT campanhas_modalidade_venda_check
  CHECK (modalidade_venda IN ('padrao', 'ultima_oportunidade', 'black_friday'));

-- 2. Resgate automatico: fora das campanhas de venda direta --------------------
CREATE OR REPLACE FUNCTION listar_candidatos_resgate(
  p_janela_dias int DEFAULT 30,
  p_silencio_dias int DEFAULT 2
)
RETURNS TABLE (
  contato_campanha_id uuid,
  campanha_id uuid,
  nome text,
  telefone text,
  status text,
  numero_contrato text,
  quantidade_fotos text,
  prazo_reciclagem text,
  ultima_interacao timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ultimas AS (
    SELECT ct.phone, max(m.created_at) AS ultima_msg
    FROM contacts ct
    JOIN messages m ON m.contact_id = ct.id AND m.direction = 'in'
    GROUP BY ct.phone
  )
  SELECT
    cc.id, cc.campanha_id, cc.nome, cc.telefone, cc.status,
    cc.numero_contrato, cc.quantidade_fotos, cc.prazo_reciclagem,
    greatest(cc.interagiu_em, u.ultima_msg) AS ultima_interacao
  FROM contatos_campanha cc
  JOIN campanhas c ON c.id = cc.campanha_id
    AND c.tipo_atendimento = 'venda_material'
    AND coalesce(c.modalidade_venda, 'padrao') NOT IN ('ultima_oportunidade', 'black_friday')
  LEFT JOIN ultimas u ON u.phone = cc.telefone
  LEFT JOIN contacts ct ON ct.phone = cc.telefone
  WHERE cc.status IN ('em_conversa', 'confirmando_dados')
    AND cc.resgate_enviado_em IS NULL
    AND greatest(cc.interagiu_em, u.ultima_msg) >= now() - make_interval(days => p_janela_dias)
    AND greatest(cc.interagiu_em, u.ultima_msg) <= now() - make_interval(days => p_silencio_dias)
    AND coalesce(ct.assigned_to, 'ia') <> 'manual'
    AND NOT EXISTS (
      SELECT 1 FROM contatos_campanha x
      WHERE x.telefone = cc.telefone AND x.status = 'comprou'
    )
    AND NOT EXISTS (
      SELECT 1 FROM resgate_envios r
      WHERE r.telefone = cc.telefone AND r.status IN ('agendado', 'enviado')
    )
    AND NOT EXISTS (
      SELECT 1 FROM contatos_campanha y
      JOIN campanhas cy ON cy.id = y.campanha_id AND cy.modalidade_venda IN ('ultima_oportunidade', 'black_friday')
      WHERE y.telefone = cc.telefone AND y.primeiro_envio_em IS NOT NULL
    )
  ORDER BY (cc.status = 'confirmando_dados') DESC, ultima_interacao DESC;
$$;

-- 3. Resumo das campanhas (uma consulta so) ------------------------------------
CREATE OR REPLACE FUNCTION resumo_campanhas()
RETURNS TABLE (campanha_id uuid, total bigint, erros_envio bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT cc.campanha_id,
         count(*) AS total,
         count(*) FILTER (WHERE cc.status = 'erro_envio') AS erros_envio
  FROM contatos_campanha cc
  GROUP BY cc.campanha_id;
$$;

GRANT EXECUTE ON FUNCTION resumo_campanhas() TO anon, authenticated, service_role;

-- 4. Indices --------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cc_campanha_status ON contatos_campanha (campanha_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone);
CREATE INDEX IF NOT EXISTS idx_messages_contact_created ON messages (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_contact_dir_created ON messages (contact_id, direction, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_contact_id ON appointments (contact_id);
CREATE INDEX IF NOT EXISTS idx_campanhas_criado_em ON campanhas (criado_em DESC);

-- Atualiza as estatisticas para o banco escolher os indices novos
ANALYZE contatos_campanha;
ANALYZE contacts;
ANALYZE messages;
ANALYZE campanhas;
