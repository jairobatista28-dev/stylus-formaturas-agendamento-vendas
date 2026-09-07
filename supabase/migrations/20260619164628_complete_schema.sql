create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null unique,
  course text,
  shift text,
  contract_number text,
  status text default 'lead',
  assigned_to text default 'ia',
  created_at timestamptz default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  direction text check (direction in ('in','out')),
  content text not null,
  sent_by text default 'ia',
  delivered boolean default false,
  read boolean default false,
  created_at timestamptz default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  date date not null,
  shift text,
  status text default 'pending',
  notes text,
  created_at timestamptz default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  target_course text default 'todos',
  initial_message text,
  created_by text,
  status text default 'draft',
  total_sent int default 0,
  total_read int default 0,
  total_replies int default 0,
  total_scheduled int default 0,
  created_at timestamptz default now()
);

create table if not exists message_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  content text not null,
  status text default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists knowledge_base (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'geral',
  question text not null,
  answer text not null,
  source text default 'manual',
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists message_queue (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid references contacts(id) on delete cascade,
  campaign_id uuid references campaigns(id) on delete set null,
  content text not null,
  scheduled_for timestamptz not null,
  status text default 'pending',
  sent_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists ai_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trigger_type text not null,
  trigger_value text,
  steps jsonb not null default '[]',
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists settings (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value text not null,
  updated_at timestamptz default now()
);

insert into settings (key, value) values
  ('min_delay_seconds', '2'),
  ('max_delay_seconds', '8'),
  ('batch_size', '50'),
  ('batch_pause_minutes', '5'),
  ('whatsapp_connected', 'false'),
  ('ai_enabled', 'true'),
  ('nome_agente', 'Sofia'),
  ('responder_automaticamente', 'true'),
  ('usar_base_conhecimento', 'true'),
  ('permitir_agendar', 'true'),
  ('system_prompt_base', 'Você é Sofia, assistente da Stylus Formaturas. Agende apresentações fotográficas com graduandos. Tom simpático e objetivo. Confirme nome, curso e horário. Use apenas informações da base de conhecimento para preços e condições.')
on conflict (key) do nothing;

insert into message_templates (name, category, content, status) values
  ('Boas-vindas', 'boas-vindas', 'Olá {{nome}}! Seja bem-vindo à Stylus Formaturas. Vamos agendar sua apresentação de material fotográfico?', 'approved'),
  ('Lembrete', 'lembrete', 'Oi {{nome}}! Lembrando que sua apresentação está agendada para {{data}} às {{turno}} no {{local}}.', 'approved'),
  ('Follow-up', 'follow-up', 'Oi {{nome}}, tudo bem? Passando para saber se você tem alguma dúvida sobre o seu pacote fotográfico.', 'approved')
on conflict do nothing;

insert into knowledge_base (category, question, answer, source) values
  ('precos', 'Qual o valor do pacote?', 'O pacote completo custa R$ 1.890 em até 12x sem juros.', 'manual'),
  ('agendamento', 'Como agendar?', 'O agendamento é feito via WhatsApp ou diretamente com nossa equipe.', 'manual'),
  ('pacotes', 'O que inclui o pacote?', 'Ensaio individual, álbum digital, caneca personalizada e acesso à cerimônia completa.', 'manual')
on conflict do nothing;

insert into ai_flows (name, trigger_type, steps) values
  ('Boas-vindas', 'primeiro_contato', '["Enviar template Boas-vindas", "Aguardar resposta", "Se positivo: oferecer horários disponíveis"]'::jsonb),
  ('Follow-up 24h', 'sem_resposta_24h', '["Enviar template Follow-up"]'::jsonb),
  ('Lembrete agendamento', '48h_antes_agendamento', '["Enviar template Lembrete"]'::jsonb)
on conflict do nothing;

insert into contacts (name, phone, course, shift, contract_number, status, assigned_to) values
  ('Lucas Carvalho', '5547991110001', 'Engenharia', 'Manhã', 'CNT-20240001', 'lead', 'ia'),
  ('Fernanda Melo', '5547991110002', 'Medicina', 'Tarde', 'CNT-20240002', 'agendado', 'manual'),
  ('Rafael Dias', '5547991110003', 'Direito', 'Noite', 'CNT-20240003', 'lead', 'ia'),
  ('Beatriz Lima', '5547991110004', 'Medicina', 'Manhã', 'CNT-20240004', 'lead', 'ia'),
  ('Carlos Souza', '5547991110005', 'Engenharia', 'Tarde', 'CNT-20240005', 'convertido', 'manual')
on conflict do nothing;