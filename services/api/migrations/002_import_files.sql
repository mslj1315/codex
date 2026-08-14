CREATE TABLE import_files (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  normalized_mime_type TEXT NOT NULL,
  byte_count BIGINT NOT NULL CHECK (byte_count BETWEEN 1 AND 5242880),
  sha256_checksum TEXT NOT NULL CHECK (length(sha256_checksum) = 64),
  object_key TEXT NOT NULL UNIQUE,
  uploaded_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  cleaned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id),
  UNIQUE (enterprise_id, store_id, sha256_checksum),
  FOREIGN KEY (batch_id, enterprise_id, store_id)
    REFERENCES import_batches (id, enterprise_id, store_id),
  CHECK (expires_at >= uploaded_at),
  CHECK (cleaned_at IS NULL OR cleaned_at >= uploaded_at)
);

CREATE INDEX import_files_expiry_idx
  ON import_files (expires_at, cleaned_at)
  WHERE cleaned_at IS NULL;
