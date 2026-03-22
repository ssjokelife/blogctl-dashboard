-- Phase 4: 브라우저 자동화 워커 스키마 변경
-- Supabase Dashboard → SQL Editor에서 실행

-- 1. publish_jobs 새 컬럼
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS published_url TEXT;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS publish_error TEXT;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS publish_error_type TEXT;
ALTER TABLE publish_jobs ADD COLUMN IF NOT EXISTS publish_attempts INT DEFAULT 0;

-- 2. worker_heartbeats 테이블
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) NOT NULL,
  worker_name TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'online',
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE worker_heartbeats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own workers"
  ON worker_heartbeats FOR ALL USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_worker_heartbeats_user_worker
  ON worker_heartbeats(user_id, worker_name);

-- 3. Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE publish_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE worker_heartbeats;

-- 4. keyword_id 존재 확인
SELECT column_name FROM information_schema.columns
WHERE table_name = 'publish_jobs' AND column_name = 'keyword_id';
