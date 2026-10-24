-- Optional: Add author_id, published, and updated_at columns to the news table in Supabase
-- Run this in your Supabase SQL Editor if you wish to enable draft/publishing states and track author UUIDs.

ALTER TABLE news ADD COLUMN IF NOT EXISTS author_id UUID;
ALTER TABLE news ADD COLUMN IF NOT EXISTS published BOOLEAN DEFAULT true;
ALTER TABLE news ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Create index on published and created_at for fast queries
CREATE INDEX IF NOT EXISTS idx_news_published ON news(published);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON news(created_at DESC);
