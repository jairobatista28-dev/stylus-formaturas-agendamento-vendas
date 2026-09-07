-- Add updated_at column to appointments table
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();