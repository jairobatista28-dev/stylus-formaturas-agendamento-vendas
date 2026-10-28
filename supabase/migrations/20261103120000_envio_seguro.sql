/*
# Envio seguro das campanhas (menos bloqueio do WhatsApp, mais respostas)

1. Abertura em dois passos: o formando recebe primeiro uma mensagem curta de
   identificacao com uma pergunta. A mensagem completa da campanha so sai depois
   que ele responde.
2. SAIR: quem responder SAIR (ou PARAR, STOP...) nunca mais recebe disparos.
3. Limite diario com aquecimento gradual, horario comercial e dias uteis.
4. Pausa automatica quando os envios comecam a falhar (sinal de bloqueio).
5. Campanha pausada passa a parar de verdade o disparo.

Idempotente.
*/

CREATE TABLE IF NOT EXISTS envio_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  abertura_ativa boolean NOT NULL DEFAULT false,
  abertura_venda text NOT NULL DEFAULT 'Oi {primeiro_nome}, tudo bem? Aqui é a Sophia, do setor de fotografia da Stylus Formaturas 😊 Posso te passar uma informação importante sobre as fotos da sua formatura{curso}?',
  abertura_agendamento text NOT NULL DEFAULT 'Oi {primeiro_nome}, tudo bem? Aqui é a Sophia, da Stylus Formaturas 😊 Posso te passar uma informação sobre a sua formatura{curso}?',
  incluir_sair boolean NOT NULL DEFAULT false,
  texto_sair text NOT NULL DEFAULT 'Se preferir não receber mensagens sobre isso, é só responder SAIR.',
  resposta_sair text NOT NULL DEFAULT 'Tudo bem! Você não vai mais receber nossas mensagens sobre isso. Se precisar de algo, é só chamar por aqui 😊',
  limite_inicial int NOT NULL DEFAULT 40,
  incremento_semanal int NOT NULL DEFAULT 20,
  limite_maximo int NOT NULL DEFAULT 150,
  aquecimento_inicio date NOT NULL DEFAULT CURRENT_DATE,
  hora_inicio int NOT NULL DEFAULT 8,
  hora_fim int NOT NULL DEFAULT 18,
  dias_semana int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  fuso text NOT NULL DEFAULT 'America/Manaus',
  falhas_para_pausar int NOT NULL DEFAULT 3,
  falhas_seguidas int NOT NULL DEFAULT 0,
  pausado boolean NOT NULL DEFAULT false,
  pausado_motivo text,
  pausado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO envio_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE envio_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "envio_config_select" ON envio_config FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "envio_config_update" ON envio_config FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Quem pediu para nao receber mais mensagens
CREATE TABLE IF NOT EXISTS optout (
  telefone text PRIMARY KEY,
  nome text,
  mensagem text,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE optout ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "optout_select" ON optout FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "optout_delete" ON optout FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Controle da abertura e do primeiro envio de cada formando
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS abertura_status text;          -- enviada | liberada | concluida
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS abertura_enviada_em timestamptz;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS primeiro_envio_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_cc_primeiro_envio ON contatos_campanha (primeiro_envio_em);
CREATE INDEX IF NOT EXISTS idx_cc_abertura ON contatos_campanha (abertura_status) WHERE abertura_status = 'enviada';

-- Mensagens liberadas pela resposta do formando passam na frente da fila
ALTER TABLE fila_envios ADD COLUMN IF NOT EXISTS prioridade int NOT NULL DEFAULT 0;

-- Fila: prioridade primeiro e nunca pega contato de campanha pausada
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
  SELECT f.contato_id INTO v_contato_id
  FROM fila_envios f
  LEFT JOIN campanhas c ON c.id = f.campanha_id
  WHERE f.status = 'pendente'
    AND coalesce(c.status, '') NOT IN ('pausada', 'paused', 'cancelada')
    AND NOT EXISTS (
      SELECT 1 FROM fila_envios f2
      WHERE f2.contato_id = f.contato_id AND f2.status = 'processando'
    )
  GROUP BY f.contato_id
  ORDER BY max(f.prioridade) DESC, f.contato_id
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
