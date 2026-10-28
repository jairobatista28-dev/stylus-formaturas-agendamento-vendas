/*
# Vinculo das vendas com a base (versao melhorada)

A 1a versao exigia nome IDENTICO e contrato IDENTICO, por isso so 1 de 36 foi ligada.
Agora compara de forma tolerante:
- contrato: so o numero da turma (8022/2023, 8022, 8.022/2023 = 8022)
- nome: ignora acentos, maiusculas, "de/da/do/dos/das/e" e sufixos com numero;
  aceita nome igual, OU mesmo primeiro e ultimo nome, OU mesmo primeiro nome + 2 nomes em comum
- formando que aparece em varias campanhas (mesmo nome) nao bloqueia o vinculo
- tambem liga ao contato do WhatsApp pelo nome, quando ha um so contato com aquele nome
No final mostra as vendas que ainda ficaram sem vinculo, com os nomes parecidos da base.
*/

CREATE OR REPLACE FUNCTION nome_tokens_venda(t text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $f$
  SELECT coalesce(array_agg(x), '{}')
  FROM unnest(regexp_split_to_array(normalizar_nome_venda(regexp_replace(coalesce(t, ''), '-\s*\d+\s*$', '')), ' ')) AS x
  WHERE x NOT IN ('', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'E')
$f$;

CREATE OR REPLACE FUNCTION contrato_turma(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$
  SELECT ltrim(regexp_replace(split_part(coalesce(t, ''), '/', 1), '\D', '', 'g'), '0')
$f$;

CREATE OR REPLACE FUNCTION pontuar_nome_venda(a text[], b text[]) RETURNS int
LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE
    WHEN cardinality(a) = 0 OR cardinality(b) = 0 THEN 0
    WHEN a = b THEN 100
    WHEN a[1] = b[1] AND a[cardinality(a)] = b[cardinality(b)] THEN 80
    WHEN a[1] = b[1] AND (SELECT count(*) FROM unnest(a) x WHERE x = ANY(b)) >= 2 THEN 60
    ELSE 0
  END
$f$;

CREATE OR REPLACE FUNCTION vincular_vendas() RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $f$
DECLARE
  v_base int := 0;
  v_nome_unico int := 0;
  v_contato int := 0;
  v_contato_nome int := 0;
  v_comprou int := 0;
BEGIN
  -- 1) Formando da campanha: mesmo numero de turma + nome compativel
  WITH cand AS (
    SELECT v.id AS vid, cc.id AS ccid, cc.telefone,
           array_to_string(nome_tokens_venda(cc.nome), ' ') AS nome_norm,
           pontuar_nome_venda(nome_tokens_venda(v.formando), nome_tokens_venda(cc.nome)) AS score
    FROM vendas v
    JOIN contatos_campanha cc
      ON contrato_turma(cc.numero_contrato) = contrato_turma(v.projeto)
    WHERE v.contato_campanha_id IS NULL
      AND contrato_turma(v.projeto) <> ''
  ),
  topo AS (
    SELECT vid, max(score) AS s FROM cand WHERE score > 0 GROUP BY vid
  ),
  unicos AS (
    SELECT c.vid FROM cand c JOIN topo t ON t.vid = c.vid AND c.score = t.s
    GROUP BY c.vid HAVING count(DISTINCT c.nome_norm) = 1
  ),
  escolha AS (
    SELECT DISTINCT ON (c.vid) c.vid, c.ccid, c.telefone
    FROM cand c
    JOIN topo t ON t.vid = c.vid AND c.score = t.s
    JOIN unicos u ON u.vid = c.vid
    ORDER BY c.vid, c.telefone NULLS LAST
  )
  UPDATE vendas v
  SET contato_campanha_id = e.ccid,
      telefone = coalesce(v.telefone, e.telefone)
  FROM escolha e
  WHERE v.id = e.vid;
  GET DIAGNOSTICS v_base = ROW_COUNT;

  -- 2) Sem turma correspondente: nome igual a um unico formando da base (em qualquer turma)
  WITH unicos AS (
    SELECT array_to_string(nome_tokens_venda(nome), ' ') AS n,
           min(id::text)::uuid AS id, min(telefone) AS telefone
    FROM contatos_campanha
    GROUP BY 1
    HAVING count(DISTINCT coalesce(contrato_turma(numero_contrato), '')) = 1
  )
  UPDATE vendas v
  SET contato_campanha_id = u.id,
      telefone = coalesce(v.telefone, u.telefone)
  FROM unicos u
  WHERE v.contato_campanha_id IS NULL
    AND u.n <> ''
    AND u.n = array_to_string(nome_tokens_venda(v.formando), ' ');
  GET DIAGNOSTICS v_nome_unico = ROW_COUNT;

  -- 3) Contato do WhatsApp pelo telefone
  UPDATE vendas v
  SET contact_id = c.id
  FROM contacts c
  WHERE v.contact_id IS NULL
    AND v.telefone IS NOT NULL
    AND c.phone = v.telefone;
  GET DIAGNOSTICS v_contato = ROW_COUNT;

  -- 4) Contato do WhatsApp pelo nome (quando existe um so contato com esse nome)
  WITH unicos AS (
    SELECT array_to_string(nome_tokens_venda(name), ' ') AS n, min(id::text)::uuid AS id, min(phone) AS phone
    FROM contacts
    GROUP BY 1
    HAVING count(*) = 1
  )
  UPDATE vendas v
  SET contact_id = u.id,
      telefone = coalesce(v.telefone, u.phone)
  FROM unicos u
  WHERE v.contact_id IS NULL
    AND u.n <> ''
    AND u.n = array_to_string(nome_tokens_venda(v.formando), ' ');
  GET DIAGNOSTICS v_contato_nome = ROW_COUNT;

  -- 5) Formando com venda registrada fica como "comprou" (todas as campanhas dele com o mesmo nome e turma)
  UPDATE contatos_campanha cc
  SET status = 'comprou'
  FROM vendas v
  JOIN contatos_campanha alvo ON alvo.id = v.contato_campanha_id
  WHERE coalesce(cc.status, '') <> 'comprou'
    AND contrato_turma(cc.numero_contrato) = contrato_turma(alvo.numero_contrato)
    AND nome_tokens_venda(cc.nome) = nome_tokens_venda(alvo.nome);
  GET DIAGNOSTICS v_comprou = ROW_COUNT;

  RETURN json_build_object(
    'ligadas_pela_turma', v_base,
    'ligadas_pelo_nome', v_nome_unico,
    'contatos_pelo_telefone', v_contato,
    'contatos_pelo_nome', v_contato_nome,
    'marcados_comprou', v_comprou,
    'total_vendas', (SELECT count(*) FROM vendas),
    'sem_vinculo', (SELECT count(*) FROM vendas WHERE contato_campanha_id IS NULL)
  );
END;
$f$;

GRANT EXECUTE ON FUNCTION vincular_vendas() TO anon, authenticated;

SELECT vincular_vendas();
