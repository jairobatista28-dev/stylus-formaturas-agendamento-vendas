-- Enable RLS and create permissive policies for Realtime to work
-- Without these, Realtime silently drops events even though the channel connects

-- Messages table
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (avoid errors)
DROP POLICY IF EXISTS "Allow anon select messages" ON messages;
DROP POLICY IF EXISTS "Allow authenticated select messages" ON messages;
DROP POLICY IF EXISTS "Allow anon insert messages" ON messages;
DROP POLICY IF EXISTS "Allow anon update messages" ON messages;
DROP POLICY IF EXISTS "Allow anon delete messages" ON messages;
DROP POLICY IF EXISTS "messages_select_all" ON messages;

-- Create policies for anon (the app uses anon key)
CREATE POLICY "Allow anon select messages" ON messages FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated select messages" ON messages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow anon insert messages" ON messages FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update messages" ON messages FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete messages" ON messages FOR DELETE TO anon USING (true);

-- Contacts table
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow anon select contacts" ON contacts;
DROP POLICY IF EXISTS "Allow authenticated select contacts" ON contacts;
DROP POLICY IF EXISTS "Allow anon insert contacts" ON contacts;
DROP POLICY IF EXISTS "Allow anon update contacts" ON contacts;
DROP POLICY IF EXISTS "Allow anon delete contacts" ON contacts;
DROP POLICY IF EXISTS "contacts_select_all" ON contacts;

-- Create policies for anon
CREATE POLICY "Allow anon select contacts" ON contacts FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated select contacts" ON contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow anon insert contacts" ON contacts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update contacts" ON contacts FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete contacts" ON contacts FOR DELETE TO anon USING (true);