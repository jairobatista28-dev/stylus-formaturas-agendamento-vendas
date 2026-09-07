-- Add unread_count to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS unread_count integer DEFAULT 0;

-- Add status to messages (sent, delivered, read)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS status text DEFAULT 'sent';

-- Update existing messages to have status based on delivered/read flags
UPDATE messages 
SET status = CASE 
  WHEN read = true THEN 'read'
  WHEN delivered = true THEN 'delivered'
  ELSE 'sent'
END
WHERE status IS NULL OR status = 'sent';