-- daily_runs 테이블: "오늘 할 일" 워크플로우 상태 관리
CREATE TABLE daily_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT NOT NULL DEFAULT 'auto',
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  analysis JSONB,
  plan JSONB,
  report TEXT,
  todos JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE daily_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own daily_runs"
  ON daily_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own daily_runs"
  ON daily_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own daily_runs"
  ON daily_runs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own daily_runs"
  ON daily_runs FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_daily_runs_user_status ON daily_runs(user_id, status);
CREATE INDEX idx_daily_runs_user_created ON daily_runs(user_id, created_at DESC);

-- publish_jobs에 daily_run_id FK 추가
ALTER TABLE publish_jobs ADD COLUMN daily_run_id UUID REFERENCES daily_runs(id);
CREATE INDEX idx_publish_jobs_daily_run ON publish_jobs(daily_run_id);

-- Realtime 활성화
ALTER PUBLICATION supabase_realtime ADD TABLE daily_runs;
