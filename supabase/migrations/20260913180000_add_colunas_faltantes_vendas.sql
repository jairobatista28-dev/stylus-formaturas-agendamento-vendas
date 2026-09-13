/*
# Colunas faltantes usadas pela tela de Vendas Pendentes

## Problema
A tela "Vendas Pendentes" (e o proprio processamento de venda no
campanha-processor) sempre leram/escreveram nas colunas `plano_escolhido`,
`forma_pagamento_escolhida` e `link_pagamento_enviado` de `contatos_campanha`,
mas nenhuma migration chegou a criar essas colunas de fato no banco. Isso
fazia o SELECT da tela falhar com erro ("Erro ao carregar vendas pendentes")
assim que havia pelo menos uma venda confirmada.

## Mudanca
Cria as 3 colunas que faltavam, idempotente (IF NOT EXISTS).
*/

ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS plano_escolhido text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS forma_pagamento_escolhida text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS link_pagamento_enviado boolean NOT NULL DEFAULT false;
