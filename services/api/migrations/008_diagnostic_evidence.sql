CREATE TABLE diagnostic_runs (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'revenue_decline'),
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  prior_range_start DATE NOT NULL,
  prior_range_end DATE NOT NULL,
  rule_version TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium')),
  snapshot_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, enterprise_id, store_id),
  UNIQUE (enterprise_id, store_id, snapshot_key),
  CHECK (range_start <= range_end),
  CHECK (prior_range_start <= prior_range_end)
);

CREATE TABLE diagnostic_evidence (
  id TEXT PRIMARY KEY,
  diagnostic_run_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  metric_key TEXT NOT NULL CHECK (metric_key = 'revenue'),
  current_value BIGINT NOT NULL,
  prior_value BIGINT NOT NULL,
  change_percent NUMERIC NOT NULL,
  current_fact_version_id TEXT NOT NULL,
  prior_fact_version_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_run_id, enterprise_id, store_id)
    REFERENCES diagnostic_runs (id, enterprise_id, store_id) ON DELETE CASCADE,
  UNIQUE (diagnostic_run_id, metric_key)
);

ALTER TABLE action_cards ADD COLUMN diagnostic_run_id TEXT;

ALTER TABLE action_cards
  ADD CONSTRAINT action_cards_diagnostic_run_scope_fk
  FOREIGN KEY (diagnostic_run_id, enterprise_id, store_id)
  REFERENCES diagnostic_runs (id, enterprise_id, store_id);
