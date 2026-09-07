-- Enable Realtime for messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable Realtime for contacts table
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;