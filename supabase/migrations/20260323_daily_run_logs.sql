-- daily_run_logs: 실시간 진행 로그
CREATE TABLE daily_run_logs (
  id BIGSERIAL PRIMARY KEY,
  daily_run_id UUID NOT NULL REFERENCES daily_runs(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE daily_run_logs ENABLE ROW LEVEL SECURITY;

-- RLS: daily_runs의 소유자만 로그 조회 가능
CREATE POLICY "Users can view logs of own daily_runs"
  ON daily_run_logs FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM daily_runs WHERE daily_runs.id = daily_run_logs.daily_run_id
    AND daily_runs.user_id = auth.uid()
  ));

CREATE INDEX idx_daily_run_logs_run ON daily_run_logs(daily_run_id, created_at);

ALTER PUBLICATION supabase_realtime ADD TABLE daily_run_logs;
