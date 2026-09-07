create table if not exists whatsapp_settings (
  id int primary key default 1,
  api_url text not null default '',
  api_token text not null default '',
  instance_name text not null default 'stylus_formaturas',
  updated_at timestamptz default now(),
  constraint single_row check (id = 1)
);

insert into whatsapp_settings (id, api_url, api_token, instance_name)
values (1, '', '', 'stylus_formaturas')
on conflict (id) do nothing;

alter table whatsapp_settings enable row level security;

drop policy if exists "whatsapp_settings_select" on whatsapp_settings;
create policy "whatsapp_settings_select"
  on whatsapp_settings for select
  using (true);

drop policy if exists "whatsapp_settings_update" on whatsapp_settings;
create policy "whatsapp_settings_update"
  on whatsapp_settings for update
  using (true)
  with check (true);

drop policy if exists "whatsapp_settings_insert" on whatsapp_settings;
create policy "whatsapp_settings_insert"
  on whatsapp_settings for insert
  with check (true);