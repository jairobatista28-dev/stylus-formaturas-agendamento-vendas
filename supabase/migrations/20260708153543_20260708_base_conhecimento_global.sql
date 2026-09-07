-- Create base_conhecimento_global table
CREATE TABLE IF NOT EXISTS base_conhecimento_global (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pergunta text NOT NULL,
  resposta text NOT NULL,
  ordem int DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for ordering
CREATE INDEX IF NOT EXISTS idx_base_conhecimento_ordem ON base_conhecimento_global(ordem);

-- Enable RLS
ALTER TABLE base_conhecimento_global ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "select_base_conhecimento" ON base_conhecimento_global FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "insert_base_conhecimento" ON base_conhecimento_global FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "update_base_conhecimento" ON base_conhecimento_global FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_base_conhecimento" ON base_conhecimento_global FOR DELETE
  TO anon, authenticated USING (true);

-- Insert some default entries
INSERT INTO base_conhecimento_global (pergunta, resposta, ordem, ativo) VALUES
('Quais formas de pagamento vocês aceitam?', 'Aceitamos cartão de crédito, débito, PIX e boleto bancário. Para formaturas, oferecemos parcelamento em até 12x.', 1, true),
('Qual o prazo de entrega das fotos?', 'O prazo padrão é de 15 a 20 dias úteis após a formatura. Para entregas expressas, consulte-nos sobre disponibilidade.', 2, true),
('Vocês atendem em qual região?', 'Atendemos todo o Brasil com equipes próprias nas principais capitais e parceiros credenciados no interior.', 3, true);