ALTER TABLE import_files
  ADD COLUMN cleanup_attempted_at TIMESTAMPTZ;

ALTER TABLE import_files
  ADD COLUMN cleanup_failure_count INTEGER NOT NULL DEFAULT 0
  CHECK (cleanup_failure_count >= 0);

CREATE INDEX import_files_cleanup_queue_idx
  ON import_files (cleanup_attempted_at, expires_at, id)
  WHERE cleaned_at IS NULL;
