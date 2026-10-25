/*
# Envio automatico de foto do formando (Meus Albuns de Formatura)

Durante a negociacao, a IA envia ao formando uma foto dele(a) (previa com marca
d'agua do proprio site), escolhida pelo Gemini, com uma frase sobre o valor da
lembranca. Uma vez por formando.

- resgate_config: fotos_ativas, fotos_visualizacao_unica, fotos_frase
- contatos_campanha: foto_enviada_em, foto_enviada_url, meusalbuns_aluno
- meusalbuns_cache: cache da lista de alunos (evita baixar 400 kB a cada envio)

Credenciais ficam em secrets do Supabase (MEUSALBUNS_EMAIL, MEUSALBUNS_SENHA),
nunca no banco. Idempotente.
*/

ALTER TABLE resgate_config ADD COLUMN IF NOT EXISTS fotos_ativas boolean NOT NULL DEFAULT false;
ALTER TABLE resgate_config ADD COLUMN IF NOT EXISTS fotos_visualizacao_unica boolean NOT NULL DEFAULT true;
ALTER TABLE resgate_config ADD COLUMN IF NOT EXISTS fotos_frase text NOT NULL
  DEFAULT 'Separei uma das suas fotos pra você ver como ficou, {nome} 📸 Essa lembrança é sua e merece ficar com você para sempre.';

ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS foto_enviada_em timestamptz;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS foto_enviada_url text;
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS meusalbuns_aluno text;

CREATE TABLE IF NOT EXISTS meusalbuns_cache (
  chave text PRIMARY KEY,
  valor jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE meusalbuns_cache ENABLE ROW LEVEL SECURITY;
-- sem policies: so a Edge Function (service role) acessa
