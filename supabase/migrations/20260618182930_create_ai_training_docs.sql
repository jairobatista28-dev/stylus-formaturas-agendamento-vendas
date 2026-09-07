CREATE TABLE ai_training_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE ai_training_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_ai_docs" ON ai_training_documents FOR SELECT
  TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "insert_own_ai_docs" ON ai_training_documents FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update_own_ai_docs" ON ai_training_documents FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete_own_ai_docs" ON ai_training_documents FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
