-- Phase 6: SNS 연동 스키마 변경
-- Supabase Dashboard → SQL Editor에서 실행

ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS sns_shared_at TIMESTAMPTZ;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS sns_status JSONB;
