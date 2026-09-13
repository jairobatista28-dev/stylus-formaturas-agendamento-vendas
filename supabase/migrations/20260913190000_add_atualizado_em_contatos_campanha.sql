/*
# Coluna atualizado_em em contatos_campanha

## Problema
A tela "Vendas Pendentes" e a busca de comprovante de pagamento (quando o
cliente envia uma foto) ordenam os resultados por `atualizado_em`, mas essa
coluna nunca existiu em `contatos_campanha` (ela so existe numa tabela antiga
e nao relacionada, `campaign_contacts`, em ingles). Isso fazia as duas
consultas falharem com o erro "column contatos_campanha.atualizado_em does
not exist".

## Mudanca
1. Adiciona `atualizado_em` (timestamptz, default now()) em `contatos_campanha`.
2. Cria um trigger que atualiza esse campo automaticamente sempre que a linha
   for alterada (reaproveita a funcao `update_updated_at_column()` ja criada
   antes pra outra tabela, que so faz `NEW.atualizado_em = NOW()`).

Idempotente (IF NOT EXISTS / DROP TRIGGER IF EXISTS).
*/

ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS atualizado_em timestamptz DEFAULT now();

DROP TRIGGER IF EXISTS update_contatos_campanha_updated_at ON contatos_campanha;

CREATE TRIGGER update_contatos_campanha_updated_at
  BEFORE UPDATE ON contatos_campanha
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
