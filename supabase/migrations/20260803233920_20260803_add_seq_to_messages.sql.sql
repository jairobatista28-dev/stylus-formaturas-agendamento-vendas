-- Add seq column to messages for stable ordering of campaign blocks
ALTER TABLE messages ADD COLUMN IF NOT EXISTS seq integer NOT NULL DEFAULT 0;