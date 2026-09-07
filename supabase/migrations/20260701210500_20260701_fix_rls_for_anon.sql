-- Fix RLS policies to allow anon access (no-auth app)
-- Drop existing policies that require authenticated role

DROP POLICY IF EXISTS select_campanhas ON campanhas;
DROP POLICY IF EXISTS insert_campanhas ON campanhas;
DROP POLICY IF EXISTS update_campanhas ON campanhas;
DROP POLICY IF EXISTS delete_campanhas ON campanhas;

DROP POLICY IF EXISTS select_contatos_campanha ON contatos_campanha;
DROP POLICY IF EXISTS insert_contatos_campanha ON contatos_campanha;
DROP POLICY IF EXISTS update_contatos_campanha ON contatos_campanha;
DROP POLICY IF EXISTS delete_contatos_campanha ON contatos_campanha;

DROP POLICY IF EXISTS select_fila_envios ON fila_envios;
DROP POLICY IF EXISTS insert_fila_envios ON fila_envios;
DROP POLICY IF EXISTS update_fila_envios ON fila_envios;
DROP POLICY IF EXISTS delete_fila_envios ON fila_envios;

-- Create new policies allowing anon and authenticated
CREATE POLICY "select_campanhas" ON campanhas FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_campanhas" ON campanhas FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_campanhas" ON campanhas FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_campanhas" ON campanhas FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "select_contatos_campanha" ON contatos_campanha FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_contatos_campanha" ON contatos_campanha FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_contatos_campanha" ON contatos_campanha FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_contatos_campanha" ON contatos_campanha FOR DELETE TO anon, authenticated USING (true);

CREATE POLICY "select_fila_envios" ON fila_envios FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_fila_envios" ON fila_envios FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_fila_envios" ON fila_envios FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_fila_envios" ON fila_envios FOR DELETE TO anon, authenticated USING (true);

-- Also fix ai_training_documents if needed
DROP POLICY IF EXISTS "Users can view own documents" ON ai_training_documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON ai_training_documents;
DROP POLICY IF EXISTS "Users can update own documents" ON ai_training_documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON ai_training_documents;

CREATE POLICY "select_ai_docs" ON ai_training_documents FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insert_ai_docs" ON ai_training_documents FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "update_ai_docs" ON ai_training_documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "delete_ai_docs" ON ai_training_documents FOR DELETE TO anon, authenticated USING (true);