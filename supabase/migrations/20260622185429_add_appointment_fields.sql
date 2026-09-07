ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS graduand_name text,
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS course text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS seller_name text,
  ADD COLUMN IF NOT EXISTS sale_value numeric;

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "allow_all_appointments_select" ON appointments FOR SELECT TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "allow_all_appointments_insert" ON appointments FOR INSERT TO anon, authenticated WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "allow_all_appointments_update" ON appointments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE POLICY "allow_all_appointments_delete" ON appointments FOR DELETE TO anon, authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null; END $$;
