/*
# Venda de material fotografico: CPF, e-mail, quantidade de fotos e conferencia de dados

1. Novas colunas em `contatos_campanha`
   - `cpf` (text)                       -> CPF do formando (vem da planilha; atualizado se ele corrigir)
   - `email` (text)                     -> e-mail do formando (idem)
   - `dados_confirmados_em` (timestamptz) -> quando o formando confirmou CPF/e-mail no WhatsApp
   - `quantidade_fotos` (text)          -> garante a coluna (nenhuma migration anterior criava)

2. Colunas de valor como texto
   `valor_tabela` e `valor_oferecido` recebem texto livre da planilha
   (ex: "Opcao 01: A vista 800,00 ..."). Se ainda estiverem como numeric,
   converte para text (sem perder dados). Protegido por bloco DO.

3. Novo status usado em `contatos_campanha.status`: 'confirmando_dados'
   (a coluna e text livre, nao precisa alterar constraint).

Idempotente: pode rodar mais de uma vez sem erro.
*/

ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS cpf text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS dados_confirmados_em timestamptz;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS quantidade_fotos text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contatos_campanha' AND column_name = 'valor_tabela' AND data_type <> 'text'
  ) THEN
    ALTER TABLE contatos_campanha ALTER COLUMN valor_tabela TYPE text USING valor_tabela::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contatos_campanha' AND column_name = 'valor_oferecido' AND data_type <> 'text'
  ) THEN
    ALTER TABLE contatos_campanha ALTER COLUMN valor_oferecido TYPE text USING valor_oferecido::text;
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Nao foi possivel converter valor_tabela/valor_oferecido para text: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_contatos_campanha_telefone_status
  ON contatos_campanha (telefone, status);
