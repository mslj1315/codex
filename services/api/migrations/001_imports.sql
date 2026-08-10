CREATE TABLE import_batches (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('csv', 'xlsx', 'manual')),
  original_file_key TEXT,
  original_file_name TEXT,
  original_file_mime_type TEXT,
  original_file_size_bytes BIGINT,
  original_file_checksum TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending_confirmation', 'confirmed')),
  range_start DATE,
  range_end DATE,
  confirmed_by_actor_id TEXT,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (range_start IS NULL OR range_end IS NULL OR range_start <= range_end),
  UNIQUE (id, enterprise_id, store_id)
);

CREATE TABLE import_candidates (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  metric_display_name TEXT NOT NULL,
  value BIGINT NOT NULL,
  unit TEXT NOT NULL,
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  source_locator TEXT NOT NULL,
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  issue_code TEXT,
  status TEXT NOT NULL CHECK (status IN ('ready', 'needs_confirmation', 'confirmed', 'rejected')),
  confirmed_value BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (range_start <= range_end),
  CHECK (value BETWEEN -9007199254740991 AND 9007199254740991),
  CHECK (confirmed_value IS NULL OR confirmed_value BETWEEN -9007199254740991 AND 9007199254740991),
  UNIQUE (id, enterprise_id, store_id),
  UNIQUE (id, batch_id, enterprise_id, store_id),
  FOREIGN KEY (batch_id, enterprise_id, store_id)
    REFERENCES import_batches (id, enterprise_id, store_id)
);

CREATE TABLE fact_versions (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  source_batch_id TEXT NOT NULL,
  confirmation_actor_id TEXT NOT NULL,
  confirmation_status TEXT NOT NULL CHECK (confirmation_status = 'confirmed'),
  confirmed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_batch_id),
  UNIQUE (id, enterprise_id, store_id),
  UNIQUE (id, source_batch_id, enterprise_id, store_id),
  FOREIGN KEY (source_batch_id, enterprise_id, store_id)
    REFERENCES import_batches (id, enterprise_id, store_id)
);

CREATE TABLE fact_values (
  id TEXT PRIMARY KEY,
  fact_version_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value BIGINT NOT NULL,
  unit TEXT NOT NULL,
  range_start DATE NOT NULL,
  range_end DATE NOT NULL,
  source_candidate_id TEXT NOT NULL,
  source_batch_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (range_start <= range_end),
  CHECK (value BETWEEN -9007199254740991 AND 9007199254740991),
  FOREIGN KEY (fact_version_id, source_batch_id, enterprise_id, store_id)
    REFERENCES fact_versions (id, source_batch_id, enterprise_id, store_id),
  FOREIGN KEY (source_candidate_id, source_batch_id, enterprise_id, store_id)
    REFERENCES import_candidates (id, batch_id, enterprise_id, store_id),
  FOREIGN KEY (source_batch_id, enterprise_id, store_id)
    REFERENCES import_batches (id, enterprise_id, store_id)
);

CREATE INDEX import_batches_tenant_store_idx ON import_batches (enterprise_id, store_id, created_at DESC);
CREATE INDEX import_candidates_batch_idx ON import_candidates (batch_id, created_at);
CREATE INDEX fact_versions_tenant_store_idx ON fact_versions (enterprise_id, store_id, confirmed_at DESC);
CREATE INDEX fact_values_version_idx ON fact_values (fact_version_id, created_at);

-- PostgreSQL append-only guards. pg-mem cannot execute PL/pgSQL trigger bodies.
CREATE OR REPLACE FUNCTION reject_fact_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'fact records are append-only';
END;
$$;

CREATE TRIGGER fact_versions_append_only
BEFORE UPDATE OR DELETE ON fact_versions
FOR EACH ROW EXECUTE FUNCTION reject_fact_mutation();

CREATE TRIGGER fact_values_append_only
BEFORE UPDATE OR DELETE ON fact_values
FOR EACH ROW EXECUTE FUNCTION reject_fact_mutation();
