/*
# Vendas realizadas (fonte oficial do total vendido)

Toda venda de material fotografico fica registrada aqui, venha de onde vier:
- campanha: marcada pela IA/painel para um formando da base
- manual: cliente que entrou em contato por fora da base e voce vendeu (botao Vendido no chat)
- planilha: importada dos acertos (Acerto_Jairo_*.xlsx)

O Funil de Vendas e a marcacao VD no chat passam a usar esta tabela.
A funcao vincular_vendas() liga cada venda ao formando da campanha (nome + contrato)
e ao contato do WhatsApp, e marca o formando como "comprou".
Idempotente: o contrato CTT e unico, rodar de novo nao duplica.
*/

CREATE TABLE IF NOT EXISTS vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_venda date NOT NULL DEFAULT CURRENT_DATE,
  formando text NOT NULL,
  telefone text,
  contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
  contato_campanha_id uuid REFERENCES contatos_campanha(id) ON DELETE SET NULL,
  projeto text,
  instituicao text,
  curso text,
  contrato_ctt text UNIQUE,
  valor_total numeric NOT NULL DEFAULT 0,
  valor_pix numeric NOT NULL DEFAULT 0,
  valor_dinheiro numeric NOT NULL DEFAULT 0,
  valor_cartao numeric NOT NULL DEFAULT 0,
  valor_cartao_ac numeric NOT NULL DEFAULT 0,
  valor_dcc numeric NOT NULL DEFAULT 0,
  valor_boleto numeric NOT NULL DEFAULT 0,
  forma_pagamento text,
  vendedor text,
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'campanha', 'planilha')),
  acerto text,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas (data_venda DESC);
CREATE INDEX IF NOT EXISTS idx_vendas_contact ON vendas (contact_id);
CREATE INDEX IF NOT EXISTS idx_vendas_cc ON vendas (contato_campanha_id);
CREATE INDEX IF NOT EXISTS idx_vendas_telefone ON vendas (telefone);

ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "vendas_select" ON vendas FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "vendas_insert" ON vendas FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "vendas_update" ON vendas FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  CREATE POLICY "vendas_delete" ON vendas FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE vendas;
EXCEPTION WHEN duplicate_object THEN null; WHEN undefined_object THEN null; END $$;

-- Nome sem acento, sem pontuacao e em maiusculas (para comparar a planilha com a base)
CREATE OR REPLACE FUNCTION normalizar_nome_venda(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT trim(regexp_replace(regexp_replace(upper(translate(coalesce(t, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^A-Z ]', ' ', 'g'), '\s+', ' ', 'g'))
$f$;

-- Liga as vendas aos formandos das campanhas e aos contatos do WhatsApp
CREATE OR REPLACE FUNCTION vincular_vendas() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $f$
DECLARE
  v_contrato int := 0;
  v_nome int := 0;
  v_contato int := 0;
  v_comprou int := 0;
BEGIN
  -- 1) Mesmo nome e mesmo contrato (projeto)
  UPDATE vendas v
  SET contato_campanha_id = cc.id,
      telefone = coalesce(v.telefone, cc.telefone)
  FROM contatos_campanha cc
  WHERE v.contato_campanha_id IS NULL
    AND normalizar_nome_venda(cc.nome) = normalizar_nome_venda(v.formando)
    AND coalesce(v.projeto, '') <> ''
    AND regexp_replace(coalesce(cc.numero_contrato, ''), '\D', '', 'g') = regexp_replace(v.projeto, '\D', '', 'g');
  GET DIAGNOSTICS v_contrato = ROW_COUNT;

  -- 2) So o nome, quando existe um unico formando com esse nome na base
  UPDATE vendas v
  SET contato_campanha_id = u.id,
      telefone = coalesce(v.telefone, u.telefone)
  FROM (
    SELECT normalizar_nome_venda(nome) AS n, min(id::text)::uuid AS id, min(telefone) AS telefone
    FROM contatos_campanha
    GROUP BY normalizar_nome_venda(nome)
    HAVING count(*) = 1
  ) u
  WHERE v.contato_campanha_id IS NULL
    AND u.n = normalizar_nome_venda(v.formando);
  GET DIAGNOSTICS v_nome = ROW_COUNT;

  -- 3) Contato do WhatsApp pelo telefone
  UPDATE vendas v
  SET contact_id = c.id
  FROM contacts c
  WHERE v.contact_id IS NULL
    AND v.telefone IS NOT NULL
    AND c.phone = v.telefone;
  GET DIAGNOSTICS v_contato = ROW_COUNT;

  -- 4) Formando com venda registrada fica como "comprou"
  UPDATE contatos_campanha cc
  SET status = 'comprou'
  WHERE cc.id IN (SELECT contato_campanha_id FROM vendas WHERE contato_campanha_id IS NOT NULL)
    AND coalesce(cc.status, '') <> 'comprou';
  GET DIAGNOSTICS v_comprou = ROW_COUNT;

  RETURN json_build_object(
    'por_contrato', v_contrato,
    'por_nome', v_nome,
    'contatos', v_contato,
    'marcados_comprou', v_comprou,
    'total_vendas', (SELECT count(*) FROM vendas),
    'sem_vinculo', (SELECT count(*) FROM vendas WHERE contato_campanha_id IS NULL)
  );
END;
$f$;

GRANT EXECUTE ON FUNCTION vincular_vendas() TO anon, authenticated;

-- Vendas dos acertos de 23/09, 06/10 e 22/10/2026 (36 vendas, R$ 28.749,00)
INSERT INTO vendas (data_venda, formando, projeto, instituicao, curso, contrato_ctt, valor_total, valor_pix, valor_dinheiro, valor_cartao, valor_cartao_ac, valor_dcc, valor_boleto, forma_pagamento, vendedor, origem, acerto)
VALUES
  ('2026-09-16', 'VICTOR BRYAN DOS SANTOS CUNHA', '8035/2023', 'Santa Tereza', 'Direito', 'NCZS25019334', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-17', 'MARCELO JOSÉ DE LIMA DUTRA', '8035/2023', 'Santa Tereza', 'Direito', 'NCZS25011026', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-18', 'THIAGO ALDIR AFFONSO ARAGÃO', '8024/2023', 'Ulbra', 'Direito', 'NCZS25013245', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-19', 'NAYARA KETHLEN MAIA DA SILVA', '8024/2023', 'Ulbra', 'Direito', 'NCZS250147R', 800.0, 400.0, 0.0, 400.0, 0.0, 0.0, 0.0, 'Pix + Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-19', 'SABRINA COELHO DE SOUZA', '8301/2026', 'Uniass. MPU', 'PED', 'NCZS250148J', 1000.0, 1000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-19', 'VANESSA DANTAS MELO', '8024/2023', 'Ulbra', 'Direito', 'NCZS25014802', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-20', 'FRANCIMARA CUNHA COELHO', '8301/2026', 'Uniass. MPU', 'PED', 'NCZS250155M', 1200.0, 0.0, 0.0, 0.0, 1200.0, 0.0, 0.0, 'Cartão AC 2x', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-21', 'ANDRESSA ARAUJO PRINTES', '8051/2023', 'Uninorte', 'Enfer', 'NCZS2502MQ', 900.0, 0.0, 0.0, 0.0, 900.0, 0.0, 0.0, 'Cartão AC 2x', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-21', 'NATHALIA KEIKO MORI', '8011/2021', 'Uninorte', 'Odonto', 'NCZS2502P14', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 23/09/2026'),
  ('2026-09-26', 'LETÍCIA SOARES CARVALHO', '8020/2025', 'Santa Tereza', 'Direito', 'NCZS2503R27', 1449.0, 0.0, 0.0, 1449.0, 0.0, 0.0, 0.0, 'Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-09-27', 'ANALU BEZERRA CAMINHA', '8021/2022', 'Fametro', 'Psicologia', 'NCZS2503Y06', 700.0, 700.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-09-27', 'MILENA SILVA DE LIMA', '8066/2022', 'Unip', 'Biomedicina', 'NCZS2503Z29', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-09-30', 'LORENA MAKLOUF CAVALCANTE', '8011/2021', 'Uninorte', 'Odonto', 'NCZS25035645', 1200.0, 0.0, 0.0, 0.0, 1200.0, 0.0, 0.0, 'Cartão AC 2x', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-09-30', 'IZABELA OLIVEIRA DE SOUZA', '8016/2023', 'Uninorte', 'Enfermagem', 'NCZS250362P', 700.0, 700.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-09-30', 'WELLISARAH CAMPELO DE AQUINO', '8024/2023', 'Ulbra', 'Direito', 'NCZS2504P10', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-02', 'DANIELE DE OLIVEIRA DOS SANTOS FREIRE', '8303/2024', 'Estacio', 'Unificados', 'NCZS25040134', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-02', 'JHENNIFER REIS DOS SANTOS', '8037/2023', 'Estacio', 'Enfermagem', 'NCZS25040255', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-03', 'EMERSON DOS SANTOS CIDADE', '8030/2024', 'Uniasselv MPU', 'Pedagogia', 'NCZS250413F', 1000.0, 1000.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-03', 'JULIANA LIMA', '8022/2023', 'Ulbra', 'Direito', 'NCZS250417W', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-03', 'ALEXANDRE LEITE MAGALHÃES', '8022/2023', 'Ulbra', 'Direito', 'NCZS25041716', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-05', 'SARA GABRIELE FERNANDES FREITAS SÁ', '8037/2023', 'Estacio', 'Enfermagem', 'NCZS25043239', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-05', 'KATHELEEN ANDRÉA OLIVEIRA SOUTO', '8022/2023', 'Ulbra', 'Direito', 'NCZS25043858', 800.0, 400.0, 0.0, 400.0, 0.0, 0.0, 0.0, 'Pix + Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-06', 'ROSILANE RAMOS GRAÇA', '8022/2023', 'Ulbra', 'Direito', 'NCZS2505F10', 1200.0, 0.0, 0.0, 0.0, 1200.0, 0.0, 0.0, 'Cartão AC 2x', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-06', 'LEILA DOS SANTOS SILVA', '8024/2023', 'Ulbra', 'Direito', 'NCZS2505F53', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-06', 'MILÍCIA MARTINS DE SOUZA', '8016/2022', 'Contabeis', 'Uninorte', 'NCZS2505K13', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 06/10/2026'),
  ('2026-10-07', 'KELLY INDAIÁ DA COSTA MACÊDO GRALHA', '8058/2022', 'UNIP', 'C.BIOLOGICAS', 'NCZS25059658', 800.0, 0.0, 0.0, 800.0, 0.0, 0.0, 0.0, 'Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-08', 'ROSÁLIA CONCEIÇÃO MENDES', '8021/2022', 'FAMETRO', 'PSICOLOGIA', 'NCZS25051954', 700.0, 700.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-08', 'URSULA DRIELE FIGUEIREDO DE SENA', '8001/2023', 'UNIP', 'BIOMEDICINA', 'NCZS250520A', 500.0, 500.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-08', 'LUIS FELIPE SILVA DOS SANTOS', '8035/2023', 'SANTA TEREZA', 'DIREITO', 'NCZS25054011', 800.0, 800.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-12', 'DÉBORA MARTINS PANTOJA', '8008/2022', 'UNINORTE', 'ENFERMAGEM', 'NCZS25069222', 800.0, 400.0, 0.0, 400.0, 0.0, 0.0, 0.0, 'Pix + Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-13', 'MARIA DA CONCEIÇÃO DO NASCIMENTO SERRA', '8303/2024', 'ESTACIO', 'PROCESSOS', 'NCZS25061328', 600.0, 0.0, 0.0, 0.0, 600.0, 0.0, 0.0, 'Cartão AC 2x', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-14', 'AMANDA RENGIFO DA SILVA', '8021/2022', 'FAMETRO', 'PSICOLOGIA', 'NCZS25064494', 700.0, 700.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-15', 'BEATRIZ SOUZA FERREIRA', '8058/2022', 'UNIP', 'C.BIOLOGICAS', 'NCZS2507P62', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-16', 'KEILLA GOMES PEREIRA', '8030/2022', 'NILTON', 'CONTABEIS', 'NCZS250724B', 600.0, 600.0, 0.0, 0.0, 0.0, 0.0, 0.0, 'Pix', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-21', 'VERA LUCIA DOS ANJOS SANTOS', '8021/2022', 'FAMETRO', 'PSICOLOGIA', 'NCZS25084611', 800.0, 0.0, 0.0, 800.0, 0.0, 0.0, 0.0, 'Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 22/10/2026'),
  ('2026-10-22', 'PATRICIA OLIVEIRA PINHEIRO', '8021/2022', 'FAMETRO', 'PSICOLOGIA', 'NCZS2509PS', 700.0, 0.0, 0.0, 700.0, 0.0, 0.0, 0.0, 'Cartão 2x', 'JAIRO', 'planilha', 'ACERTO 22/10/2026')
ON CONFLICT (contrato_ctt) DO NOTHING;

SELECT vincular_vendas();
