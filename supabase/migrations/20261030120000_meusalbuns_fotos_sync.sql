/*
# Fotos sincronizadas do Meus Albuns (plano B, sem depender do login do site)

O codigo de sincronizacao roda no navegador ja logado no Meus Albuns, le algumas
fotos de cada formando das campanhas de venda e grava aqui. Depois disso a IA
envia as fotos 24h (os enderecos das fotos abrem sem login).

So a Edge Function (service role) acessa esta tabela. Idempotente.
*/

CREATE TABLE IF NOT EXISTS meusalbuns_fotos (
  aluno_cript text PRIMARY KEY,
  nome_aluno text NOT NULL,
  pit text NOT NULL,
  qtd_fotos int,
  token_foto text NOT NULL,
  fotos jsonb NOT NULL DEFAULT '[]'::jsonb,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meusalbuns_fotos_pit ON meusalbuns_fotos (pit);

ALTER TABLE meusalbuns_fotos ENABLE ROW LEVEL SECURITY;
