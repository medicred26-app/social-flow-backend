-- =============================================================
-- SocialFlow Messaging System Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- Project → SQL Editor → New Query → Paste & Run
-- =============================================================

-- =====================
-- MESSAGING TABLES
-- =====================

-- 12. Conversations (Client ↔ Freelancer threads)
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_1_id VARCHAR(100) NOT NULL,
  participant_1_name VARCHAR(150) DEFAULT '',
  participant_1_avatar TEXT DEFAULT '',
  participant_2_id VARCHAR(100) NOT NULL,
  participant_2_name VARCHAR(150) DEFAULT '',
  participant_2_avatar TEXT DEFAULT '',
  last_message_text TEXT DEFAULT '',
  last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  unread_count_1 INT DEFAULT 0,
  unread_count_2 INT DEFAULT 0,
  job_id UUID DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 13. Messages (Individual messages within conversations)
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id VARCHAR(100) NOT NULL,
  sender_name VARCHAR(150) DEFAULT '',
  sender_avatar TEXT DEFAULT '',
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================
-- INDEXES
-- =====================
CREATE INDEX IF NOT EXISTS idx_conversations_participant_1 ON conversations(participant_1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_2 ON conversations(participant_2_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

-- =====================
-- ROW LEVEL SECURITY (RLS)
-- =====================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (backend uses service_role key)
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON messages FOR ALL USING (true) WITH CHECK (true);

-- =====================
-- ENABLE REALTIME
-- =====================
-- This enables Supabase Realtime subscriptions on both tables
-- so the frontend can receive live updates without polling
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
