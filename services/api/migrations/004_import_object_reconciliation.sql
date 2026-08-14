CREATE TABLE import_object_reconciliation_jobs (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  sha256_checksum TEXT NOT NULL CHECK (length(sha256_checksum) = 64),
  object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('delete_orphan', 'verify_batch_then_delete')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'resolved')),
  not_before TIMESTAMPTZ NOT NULL, attempted_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  resolved_at TIMESTAMPTZ, resolution TEXT CHECK (resolution IS NULL OR resolution IN ('object_removed', 'persistence_committed')),
  last_error_type TEXT, last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX import_object_reconciliation_queue_idx
  ON import_object_reconciliation_jobs (not_before, attempted_at, created_at, id)
  WHERE state = 'pending';
