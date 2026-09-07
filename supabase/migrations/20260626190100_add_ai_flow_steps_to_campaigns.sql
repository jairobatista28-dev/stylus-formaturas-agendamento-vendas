-- Add ai_flow_steps column to campaigns for defining AI conversation flow
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS ai_flow_steps JSONB DEFAULT '[]'::jsonb;

-- Add example AI flow steps to existing campaigns (optional update)
UPDATE campaigns 
SET ai_flow_steps = '[
  {"step": 1, "message": "Ola {{nome_formando}}! Somos da Stylus Formaturas. Gostariamos de agendar sua sessao de fotos.", "wait_seconds": 0},
  {"step": 2, "message": "Voce esta disponivel para agendamento?", "wait_seconds": 3},
  {"step": 3, "message": "Qual turno voce prefere? Manha, Tarde ou Noite?", "wait_seconds": 5},
  {"step": 4, "message": "Qual data voce prefere? (Formato: DD/MM/YYYY)", "wait_seconds": 5},
  {"step": 5, "message": "Perfeito! Vou confirmar seu agendamento...", "wait_seconds": 3}
]'::jsonb
WHERE ai_flow_steps IS NULL OR ai_flow_steps = '[]'::jsonb;