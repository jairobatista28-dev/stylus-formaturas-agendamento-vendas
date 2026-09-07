-- Tabela de Campanhas (nova estrutura em português)
CREATE TABLE IF NOT EXISTS campanhas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  nome text NOT NULL,
  descricao text,
  mensagem_inicial text NOT NULL,
  prompt_ia text,
  status text DEFAULT 'rascunho',
  criado_em timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Contatos Importados
CREATE TABLE IF NOT EXISTS contatos_campanha (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  nome text NOT NULL,
  telefone text NOT NULL,
  status text DEFAULT 'aguardando_inicio',
  interagiu_em timestamp with time zone,
  criado_em timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Tabela de Fila de Envios
CREATE TABLE IF NOT EXISTS fila_envios (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  contato_id uuid REFERENCES contatos_campanha(id) ON DELETE CASCADE,
  campanha_id uuid REFERENCES campanhas(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  mensagem text NOT NULL,
  status text DEFAULT 'pendente',
  delay_bloqueio int DEFAULT 0,
  delay_bloco int DEFAULT 0,
  simular_digitacao int DEFAULT 2,
  ordem_bloco int NOT NULL,
  criado_em timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_contatos_campanha_campanha_id ON contatos_campanha(campanha_id);
CREATE INDEX IF NOT EXISTS idx_contatos_campanha_status ON contatos_campanha(status);
CREATE INDEX IF NOT EXISTS idx_fila_envios_status ON fila_envios(status);
CREATE INDEX IF NOT EXISTS idx_fila_envios_campanha_id ON fila_envios(campanha_id);

-- Habilitar RLS
ALTER TABLE campanhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE contatos_campanha ENABLE ROW LEVEL SECURITY;
ALTER TABLE fila_envios ENABLE ROW LEVEL SECURITY;

-- Políticas RLS para campanhas
CREATE POLICY "select_campanhas" ON campanhas FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_campanhas" ON campanhas FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_campanhas" ON campanhas FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_campanhas" ON campanhas FOR DELETE
  TO authenticated USING (true);

-- Políticas RLS para contatos_campanha
CREATE POLICY "select_contatos_campanha" ON contatos_campanha FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_contatos_campanha" ON contatos_campanha FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_contatos_campanha" ON contatos_campanha FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_contatos_campanha" ON contatos_campanha FOR DELETE
  TO authenticated USING (true);

-- Políticas RLS para fila_envios
CREATE POLICY "select_fila_envios" ON fila_envios FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_fila_envios" ON fila_envios FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_fila_envios" ON fila_envios FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_fila_envios" ON fila_envios FOR DELETE
  TO authenticated USING (true);