CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  digest TEXT NOT NULL,
  source_yaml TEXT NOT NULL,
  compiled_json JSONB NOT NULL,
  admission_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id UUID PRIMARY KEY,
  agent_id TEXT NOT NULL,
  command TEXT NOT NULL,
  workspace_ref TEXT NOT NULL,
  policy_id TEXT NOT NULL REFERENCES policies(id),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'rejected')),
  delta_json JSONB,
  risk_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);
