-- =============================================================
-- SocialFlow Messaging Attachments & Storage Migration
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- =============================================================

-- 1. Add attachment columns to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_url TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name TEXT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_type VARCHAR(50) DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size BIGINT DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) DEFAULT NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS storage_path TEXT DEFAULT NULL;

-- 2. Create Storage Bucket for Chat Attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments', 
  'chat-attachments', 
  true, 
  1073741824, -- 1GB file size limit for large video uploads
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'text/plain']
)
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = 1073741824;

-- 3. Row Level Security Policies for Storage
CREATE POLICY "Public Read Chat Attachments" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'chat-attachments');

CREATE POLICY "Authenticated Insert Chat Attachments" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'chat-attachments');

CREATE POLICY "Authenticated Delete Chat Attachments" 
  ON storage.objects FOR DELETE 
  USING (bucket_id = 'chat-attachments');
