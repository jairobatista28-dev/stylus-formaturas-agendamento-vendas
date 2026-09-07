-- Add columns to campanhas
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS base_conhecimento text;
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS opcoes_agendamento jsonb DEFAULT '[]';

-- Create conversa_estado table for state machine
CREATE TABLE IF NOT EXISTS conversa_estado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  contato_telefone text NOT NULL,
  contato_nome text,
  bloco_atual int DEFAULT 0,
  aguardando_resposta boolean DEFAULT false,
  proxima_execucao timestamptz,
  status text DEFAULT 'ativo',
  tentativas_falha int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(campanha_id, contato_telefone)
);

-- Create envio_log table for anti-ban tracking
CREATE TABLE IF NOT EXISTS envio_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  contato_telefone text NOT NULL,
  sucesso boolean NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_conversa_proxima_execucao ON conversa_estado(proxima_execucao) WHERE status = 'aguardando_tempo';
CREATE INDEX IF NOT EXISTS idx_envio_log_campanha_created ON envio_log(campanha_id, created_at);
CREATE INDEX IF NOT EXISTS idx_conversa_campanha_status ON conversa_estado(campanha_id, status);
CREATE INDEX IF NOT EXISTS idx_conversa_telefone ON conversa_estado(contato_telefone);

-- Enable RLS
ALTER TABLE conversa_estado ENABLE ROW LEVEL SECURITY;
ALTER TABLE envio_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies for conversa_estado
CREATE POLICY "select_conversa_estado" ON conversa_estado FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "insert_conversa_estado" ON conversa_estado FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "update_conversa_estado" ON conversa_estado FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

-- RLS Policies for envio_log
CREATE POLICY "select_envio_log" ON envio_log FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "insert_envio_log" ON envio_log FOR INSERT
  TO anon, authenticated WITH CHECK (true);

-- Add rate_limit_hora column to campanhas
ALTER TABLE campanhas ADD COLUMN IF NOT EXISTS rate_limit_hora int DEFAULT 40;