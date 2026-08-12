CREATE TABLE action_cards (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  created_by_actor_id TEXT NOT NULL,
  diagnostic_kind TEXT NOT NULL,
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  title TEXT NOT NULL,
  action TEXT NOT NULL,
  verification_metric TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'in_progress', 'completed', 'verified', 'cancelled')),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, enterprise_id, store_id),
  CHECK (range_start <= range_end)
);

CREATE INDEX action_cards_store_status_idx ON action_cards (enterprise_id, store_id, status, created_at DESC);
