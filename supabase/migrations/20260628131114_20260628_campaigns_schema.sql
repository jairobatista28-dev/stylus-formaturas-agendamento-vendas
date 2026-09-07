create table if not exists campaigns(id uuid primary key default gen_random_uuid(),name text not null,course_target text,description text,initial_message text,available_slots text,session_location text,session_duration text,scheduling_deadline text,conversation_tone text default 'friendly',objection_handling text,extra_info text,ai_prompt_extra text,ai_prompt text,delay_between_messages_ms integer default 8000,max_overflow_attempts integer default 3,status text default 'draft',contacts_count integer default 0,sent_count integer default 0,scheduled_count integer default 0,overflow_count integer default 0,created_at timestamptz default now(),updated_at timestamptz default now());

create table if not exists campaign_contacts(id uuid primary key default gen_random_uuid(),campaign_id uuid references campaigns(id) on delete cascade,nome text not null,telefone text not null,numero_contrato text,curso text,endereco text,status text default 'pending',conversation_id uuid,attempts integer default 0,last_message_at timestamptz,metadata jsonb,created_at timestamptz default now());

create table if not exists conversations(id uuid primary key default gen_random_uuid(),campaign_contact_id uuid references campaign_contacts(id),campaign_id uuid references campaigns(id),phone text not null,status text default 'active',messages jsonb default '[]',extracted_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());

alter table appointments add column if not exists campaign_contact_id uuid references campaign_contacts(id);
alter table appointments add column if not exists campaign_id uuid references campaigns(id);

create or replace function increment_campaign_counter(p_campaign_id uuid,p_field text)
returns void language plpgsql as $$
begin execute format('update campaigns set %I=%I+1,updated_at=now() where id=$1',p_field,p_field) using p_campaign_id;end;$$;