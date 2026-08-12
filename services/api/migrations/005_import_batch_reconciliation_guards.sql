CREATE TABLE import_batch_reconciliation_guards (
  batch_id TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
