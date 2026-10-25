/*
# Resgate automatico de formandos (venda de material fotografico)

Formandos que demonstraram interesse nos ultimos N dias (responderam, pediram
valores, escolheram opcao etc.) mas NAO compraram recebem UMA nova abordagem
automatica avisando da prorrogacao do prazo de reciclagem.

1. contatos_campanha: prazo_prorrogado, resgate_enviado_em, resgate_variante
2. resgate_config (linha unica): liga/desliga, limite diario, horarios, prorrogacao
3. resgate_envios: fila/historico de cada abordagem (agendado/enviado/cancelado/erro)
4. listar_candidatos_resgate(): quem pode ser resgatado
5. Cron a cada 10 min chamando a Edge Function resgate-vendas

Nunca entram no resgate: quem esta como Vendido (status 'comprou', em qualquer
campanha com o mesmo telefone), sem_interesse, transferido_humano,
interessado_compra (ja esta com o especialista), contatos em modo manual e
quem ja recebeu resgate.

Idempotente.
*/

-- 1. Colunas novas -------------------------------------------------------------
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS prazo_prorrogado date;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS resgate_enviado_em timestamptz;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS resgate_variante int;

-- 2. Configuracao --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resgate_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo boolean NOT NULL DEFAULT false,
  limite_diario int NOT NULL DEFAULT 10,
  janela_dias int NOT NULL DEFAULT 30,
  silencio_minimo_dias int NOT NULL DEFAULT 2,
  dias_prorrogacao int NOT NULL DEFAULT 30,
  base_prorrogacao text NOT NULL DEFAULT 'prazo_planilha'
    CHECK (base_prorrogacao IN ('prazo_planilha', 'data_resgate')),
  hora_inicio int NOT NULL DEFAULT 9,
  hora_fim int NOT NULL DEFAULT 19,
  dias_semana int[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  fuso text NOT NULL DEFAULT 'America/Manaus',
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO resgate_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE resgate_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_resgate_config" ON resgate_config;
CREATE POLICY "select_resgate_config" ON resgate_config FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "update_resgate_config" ON resgate_config;
CREATE POLICY "update_resgate_config" ON resgate_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 3. Fila / historico ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS resgate_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contato_campanha_id uuid REFERENCES contatos_campanha(id) ON DELETE CASCADE,
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  nome text,
  telefone text NOT NULL,
  data_ref date NOT NULL,
  agendado_para timestamptz NOT NULL,
  variante int,
  status text NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado', 'enviado', 'cancelado', 'erro')),
  motivo text,
  mensagem text,
  prazo_prorrogado date,
  enviado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resgate_envios_contato_ativo
  ON resgate_envios (contato_campanha_id)
  WHERE status IN ('agendado', 'enviado');
CREATE INDEX IF NOT EXISTS idx_resgate_envios_pendentes
  ON resgate_envios (agendado_para) WHERE status = 'agendado';
CREATE INDEX IF NOT EXISTS idx_resgate_envios_data_ref ON resgate_envios (data_ref);

ALTER TABLE resgate_envios ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_resgate_envios" ON resgate_envios;
CREATE POLICY "select_resgate_envios" ON resgate_envios FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "update_resgate_envios" ON resgate_envios;
CREATE POLICY "update_resgate_envios" ON resgate_envios FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- 4. Candidatos ----------------------------------------------------------------
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
  JOIN campanhas c ON c.id = cc.campanha_id AND c.tipo_atendimento = 'venda_material'
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
  ORDER BY (cc.status = 'confirmando_dados') DESC, ultima_interacao DESC;
$$;

-- 5. Cron (a cada 10 minutos) --------------------------------------------------
SELECT cron.unschedule('resgate-vendas-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'resgate-vendas-10min');

SELECT cron.schedule(
  'resgate-vendas-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://jnusnsktoddihfoizlpr.supabase.co/functions/v1/resgate-vendas',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"acao": "executar"}'::jsonb
  );
  $$
);
