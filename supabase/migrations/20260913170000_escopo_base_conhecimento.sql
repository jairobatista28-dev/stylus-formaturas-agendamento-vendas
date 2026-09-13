/*
# Escopo por tipo de campanha na base de conhecimento global

## Problema
A base de conhecimento global era aplicada em TODAS as campanhas, sem
distincao de tipo. Isso fazia a IA usar respostas pensadas pra campanhas de
agendamento/visita (ex: "no ato da visita nossa equipe apresenta os
valores") mesmo em campanhas de venda de material fotografico, onde a venda
e direta e nao ha visita de representante — confundindo o cliente com uma
resposta que nao se aplica aquele fluxo.

## Mudanca
Adiciona `aplica_em` em `base_conhecimento_global`, com 3 valores possiveis:
- 'todos' (padrao — mantem o comportamento atual pra perguntas genericas)
- 'agendamento' (so aparece em campanhas de agendamento/visita)
- 'venda_material' (so aparece em campanhas de venda de material fotografico)

Todas as perguntas ja cadastradas continuam com 'todos' (nenhuma quebra),
e o proprio usuario pode reclassificar as que forem especificas de um
fluxo (como a resposta sobre "valores no ato da visita") pela tela de
Configuracoes.
*/

ALTER TABLE base_conhecimento_global
  ADD COLUMN IF NOT EXISTS aplica_em text NOT NULL DEFAULT 'todos';

ALTER TABLE base_conhecimento_global
  DROP CONSTRAINT IF EXISTS base_conhecimento_global_aplica_em_check;

ALTER TABLE base_conhecimento_global
  ADD CONSTRAINT base_conhecimento_global_aplica_em_check
  CHECK (aplica_em IN ('todos', 'agendamento', 'venda_material'));
