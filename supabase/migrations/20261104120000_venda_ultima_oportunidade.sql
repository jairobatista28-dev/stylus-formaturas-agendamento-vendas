/*
# Campanha de venda "Ultima Oportunidade" (pre-venda, sem visita)

Novo modelo de campanha para formandos que agendaram visita e nao compraram,
ou que nem chegaram a agendar. A venda e feita 100% pela IA no WhatsApp,
mantendo os valores de pre-venda (ultima oportunidade), com envio de 3 fotos
do formando (beca / familia) em visualizacao unica.

A campanha continua sendo tipo_atendimento = 'venda_material' (reaproveita
funil, conferencia de CPF/e-mail, notificacao ao vendedor, comprovante etc.)
e ganha a coluna modalidade_venda:
  - 'padrao'               -> venda de material como ja funciona hoje
  - 'ultima_oportunidade'  -> nova campanha (sem falar de reciclagem/perda,
                              historico antigo de agendamento e ignorado)

Tambem tira essas campanhas do resgate automatico (prorrogacao), porque a
prorrogacao fala de reciclagem e contradiz "ultima oportunidade".

Idempotente.
*/

-- 1. Modalidade da campanha de venda -----------------------------------------
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS modalidade_venda text NOT NULL DEFAULT 'padrao';

DO $$ BEGIN
  ALTER TABLE campanhas
    ADD CONSTRAINT campanhas_modalidade_venda_check
    CHECK (modalidade_venda IN ('padrao', 'ultima_oportunidade'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 2. Controle do kit de 3 fotos -----------------------------------------------
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS fotos_kit_enviadas int NOT NULL DEFAULT 0;

-- 3. Resgate automatico: ignora campanhas "ultima oportunidade" e nao aborda
--    (por outra campanha) quem ja esta numa campanha de ultima oportunidade
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
    AND coalesce(c.modalidade_venda, 'padrao') <> 'ultima_oportunidade'
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
      JOIN campanhas cy ON cy.id = y.campanha_id AND cy.modalidade_venda = 'ultima_oportunidade'
      WHERE y.telefone = cc.telefone AND y.primeiro_envio_em IS NOT NULL
    )
  ORDER BY (cc.status = 'confirmando_dados') DESC, ultima_interacao DESC;
$$;
