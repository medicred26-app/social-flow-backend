-- =============================================================
-- SocialFlow Complete Database Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard)
-- Project → SQL Editor → New Query → Paste & Run
-- =============================================================

-- =====================
-- CORE TABLES
-- =====================

-- 1. Social Accounts (Stores connected Facebook, Instagram, YouTube tokens)
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key VARCHAR(200) UNIQUE NOT NULL,
  platform VARCHAR(50) NOT NULL,
  account_id VARCHAR(200) DEFAULT '',
  name VARCHAR(255) DEFAULT '',
  handle VARCHAR(255) DEFAULT '',
  avatar TEXT DEFAULT '',
  followers INT DEFAULT 0,
  access_token TEXT DEFAULT '',
  refresh_token TEXT DEFAULT '',
  status VARCHAR(50) DEFAULT 'connected',
  user_id VARCHAR(200),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Connected Accounts (YouTube OAuth flow)
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform VARCHAR(50) NOT NULL,
  channel_id VARCHAR(200),
  channel_title VARCHAR(255),
  access_token TEXT,
  refresh_token TEXT,
  token_expiry TIMESTAMP WITH TIME ZONE,
  status VARCHAR(50) DEFAULT 'connected',
  user_id VARCHAR(200),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. AI Generations (Stores AI-generated content history)
CREATE TABLE IF NOT EXISTS ai_generations (
  id VARCHAR(200) PRIMARY KEY,
  user_id VARCHAR(200),
  type VARCHAR(100),
  platform VARCHAR(100),
  input_content TEXT,
  output_content JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================
-- MARKETPLACE TABLES
-- =====================

-- 4. Platform Settings (Configurable Commission System)
CREATE TABLE IF NOT EXISTS platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO platform_settings (setting_key, setting_value)
VALUES ('commission_rate', '{"percentage": 15}'::jsonb)
ON CONFLICT (setting_key) DO NOTHING;

-- 5. Marketplace Categories
CREATE TABLE IF NOT EXISTS marketplace_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  icon VARCHAR(50) DEFAULT 'Briefcase',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed Initial Categories
INSERT INTO marketplace_categories (name, slug, icon, description) VALUES
('Video Editors', 'video-editors', 'Video', 'Reels, Shorts, Promo videos, and YouTube editing'),
('Graphic Designers', 'graphic-designers', 'Palette', 'Thumbnails, banners, social posts, and branding'),
('SEO Specialists', 'seo-specialists', 'Search', 'Search engine optimization, keywords, and audit'),
('Social Media Managers', 'social-media-managers', 'Share2', 'Content scheduling, channel management, and growth'),
('Content Writers', 'content-writers', 'PenTool', 'Captions, blogs, website copy, and newsletters'),
('Digital Marketers', 'digital-marketers', 'TrendingUp', 'Paid ads, Meta ads, Google ads, and strategy'),
('Content Creators', 'content-creators', 'Camera', 'UGC content, video creation, and influencer media'),
('Copywriters', 'copywriters', 'FileText', 'Ad copy, sales copy, and persuasive posts'),
('AI/Automation Specialists', 'ai-automation-specialists', 'Cpu', 'Workflows, chatbots, and AI social automation')
ON CONFLICT (slug) DO NOTHING;

-- 6. Freelancer Profiles
CREATE TABLE IF NOT EXISTS freelancer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  user_name VARCHAR(150),
  user_avatar TEXT,
  professional_title VARCHAR(150) NOT NULL,
  bio TEXT NOT NULL,
  skills TEXT[] DEFAULT '{}',
  categories TEXT[] DEFAULT '{}',
  experience_years INT DEFAULT 1,
  availability_status VARCHAR(50) DEFAULT 'available',
  verification_status VARCHAR(50) DEFAULT 'pending_review',
  hourly_rate NUMERIC(10,2) DEFAULT 0.00,
  portfolio_links JSONB DEFAULT '[]'::jsonb,
  rating_avg NUMERIC(3,2) DEFAULT 0.00,
  completed_jobs_count INT DEFAULT 0,
  rejection_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. Marketplace Services
CREATE TABLE IF NOT EXISTS marketplace_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id UUID REFERENCES freelancer_profiles(id) ON DELETE CASCADE,
  category_slug VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  delivery_days INT NOT NULL DEFAULT 1,
  revisions INT NOT NULL DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. Portfolio Items
CREATE TABLE IF NOT EXISTS portfolio_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  freelancer_id UUID REFERENCES freelancer_profiles(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  media_url TEXT NOT NULL,
  external_url TEXT,
  category VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 9. Jobs / Projects System
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id VARCHAR(100) NOT NULL,
  client_name VARCHAR(150),
  client_email VARCHAR(255),
  freelancer_id UUID REFERENCES freelancer_profiles(id) ON DELETE RESTRICT,
  service_id UUID REFERENCES marketplace_services(id) ON DELETE SET NULL,
  title VARCHAR(250) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(100) NOT NULL,
  budget NUMERIC(10,2) NOT NULL,
  commission_percentage NUMERIC(5,2) DEFAULT 15.00,
  platform_fee NUMERIC(10,2) NOT NULL,
  freelancer_amount NUMERIC(10,2) NOT NULL,
  deadline_days INT DEFAULT 7,
  status VARCHAR(50) DEFAULT 'requested',
  requirements TEXT,
  deliverable_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 10. Reviews & Ratings
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  client_id VARCHAR(100) NOT NULL,
  client_name VARCHAR(150),
  freelancer_id UUID REFERENCES freelancer_profiles(id) ON DELETE CASCADE,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. Marketplace Payments
CREATE TABLE IF NOT EXISTS marketplace_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  client_id VARCHAR(100) NOT NULL,
  freelancer_id UUID REFERENCES freelancer_profiles(id) ON DELETE RESTRICT,
  gross_amount NUMERIC(10,2) NOT NULL,
  commission_rate NUMERIC(5,2) NOT NULL,
  commission_amount NUMERIC(10,2) NOT NULL,
  freelancer_amount NUMERIC(10,2) NOT NULL,
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_provider VARCHAR(50) DEFAULT 'stripe',
  transaction_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================
-- INDEXES
-- =====================
CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_social_accounts_status ON social_accounts(status);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_platform ON connected_accounts(platform);
CREATE INDEX IF NOT EXISTS idx_ai_generations_user ON ai_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_freelancer_status ON freelancer_profiles(verification_status);
CREATE INDEX IF NOT EXISTS idx_services_freelancer ON marketplace_services(freelancer_id);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client_id);
CREATE INDEX IF NOT EXISTS idx_jobs_freelancer ON jobs(freelancer_id);

-- =====================
-- ROW LEVEL SECURITY (RLS) - Disable for service_role usage
-- =====================
-- Since the backend uses the service_role key, RLS is bypassed.
-- If you want to enable RLS for anon/authenticated roles in the future,
-- add policies here.

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE connected_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE freelancer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_payments ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access (backend uses service_role key)
-- Allow anon/authenticated read access to public tables (categories, services, freelancer profiles)

CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON social_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON connected_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON ai_generations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON platform_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON marketplace_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON freelancer_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON marketplace_services FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON portfolio_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON marketplace_payments FOR ALL USING (true) WITH CHECK (true);

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

CREATE INDEX IF NOT EXISTS idx_conversations_participant_1 ON conversations(participant_1_id);
CREATE INDEX IF NOT EXISTS idx_conversations_participant_2 ON conversations(participant_2_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY IF NOT EXISTS "Allow all for service_role" ON messages FOR ALL USING (true) WITH CHECK (true);

-- Enable Supabase Realtime on messaging tables
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
