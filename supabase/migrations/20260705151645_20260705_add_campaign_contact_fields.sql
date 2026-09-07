-- Add missing columns to contatos_campanha for IA flow

-- Add endereco/local column
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS local text;

-- Add contract number column
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS numero_contrato text;

-- Add course column
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS curso text;

-- Add follow_up control column
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS follow_up_enviado boolean DEFAULT false;

-- Add updated_at timestamp
ALTER TABLE contatos_campanha ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Add phone column to match contacts table (telefone already exists)

-- Create index for faster lookup by status
CREATE INDEX IF NOT EXISTS idx_contatos_campanha_status ON contatos_campanha(status);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for contatos_campanha
DROP TRIGGER IF EXISTS update_contatos_campanha_updated_at ON contatos_campanha;
CREATE TRIGGER update_contatos_campanha_updated_at
  BEFORE UPDATE ON contatos_campanha
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();