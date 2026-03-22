-- Phase 5: GSC 인덱싱 연동 스키마 변경
-- Supabase Dashboard → SQL Editor에서 실행

ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMPTZ;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS index_status TEXT;
