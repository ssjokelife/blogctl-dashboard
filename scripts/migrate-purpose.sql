-- Blog Purpose Migration
-- Run in Supabase SQL Editor

-- 1. Add purpose column
ALTER TABLE blogs ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'adsense'
  CHECK (purpose IN ('adsense', 'coupang', 'naver_experience'));

-- 2. Migrate existing data (verify with SELECT first)
-- SELECT id, label, platform, adapter FROM blogs;
UPDATE blogs SET purpose = 'coupang' WHERE adapter = 'coupang';
UPDATE blogs SET purpose = 'naver_experience' WHERE platform = 'naver';
