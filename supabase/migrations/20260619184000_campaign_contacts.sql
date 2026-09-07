-- Add columns to campaigns table for scheduling automation
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduling_enabled BOOLEAN DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduling_shifts JSONB DEFAULT '["Manhã", "Tarde", "Noite"]'::jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduling_locations JSONB DEFAULT '[]'::jsonb;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS auto_schedule_days INTEGER DEFAULT 30;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_contacts INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_scheduled_campaign INTEGER DEFAULT 0;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_overflowed INTEGER DEFAULT 0;

-- Create campaign_contacts table
CREATE TABLE IF NOT EXISTS campaign_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  nome_formando TEXT NOT NULL,
  telefone TEXT NOT NULL,
  numero_contrato TEXT,
  status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'em_atendimento', 'agendado', 'transbordado_humano', 'sem_resposta', 'erro_envio')),
  data_agendamento TIMESTAMPTZ,
  confirmacao_local TEXT,
  turno_agendamento TEXT,
  observacoes TEXT,
  tentativas_envio INTEGER DEFAULT 0,
  ultima_interacao TIMESTAMPTZ,
  criado_em TIMESTAMPTZ DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, telefone)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_phone ON campaign_contacts(telefone);

-- Enable RLS
ALTER TABLE campaign_contacts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for campaign_contacts
CREATE POLICY "select_own_campaign_contacts" ON campaign_contacts FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_own_campaign_contacts" ON campaign_contacts FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_own_campaign_contacts" ON campaign_contacts FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_own_campaign_contacts" ON campaign_contacts FOR DELETE
  TO authenticated USING (true);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_campaign_contacts_updated_at
    BEFORE UPDATE ON campaign_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update campaign stats
CREATE OR REPLACE FUNCTION update_campaign_stats(p_campaign_id UUID)
RETURNS VOID AS $$
DECLARE
  v_total INTEGER;
  v_agendados INTEGER;
  v_overflowed INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_total FROM campaign_contacts WHERE campaign_id = p_campaign_id;
  SELECT COUNT(*) INTO v_agendados FROM campaign_contacts WHERE campaign_id = p_campaign_id AND status = 'agendado';
  SELECT COUNT(*) INTO v_overflowed FROM campaign_contacts WHERE campaign_id = p_campaign_id AND status = 'transbordado_humano';
  
  UPDATE campaigns 
  SET total_contacts = v_total,
      total_scheduled_campaign = v_agendados,
      total_overflowed = v_overflowed
  WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update campaign stats
CREATE OR REPLACE FUNCTION trigger_update_campaign_stats()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM update_campaign_stats(NEW.campaign_id);
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER campaign_contacts_stats_trigger
    AFTER INSERT OR UPDATE OR DELETE ON campaign_contacts
    FOR EACH ROW
    EXECUTE FUNCTION trigger_update_campaign_stats();

-- Add columns to contacts for linking to campaigns
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS campaign_contact_id UUID REFERENCES campaign_contacts(id) ON DELETE SET NULL;