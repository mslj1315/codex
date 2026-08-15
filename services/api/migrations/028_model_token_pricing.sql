CREATE TABLE model_token_price_versions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_cny_per_million_tokens NUMERIC(18,6) NOT NULL CHECK (input_cny_per_million_tokens >= 0),
  output_cny_per_million_tokens NUMERIC(18,6) NOT NULL CHECK (output_cny_per_million_tokens >= 0),
  effective_from TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, model, effective_from)
);

ALTER TABLE content_task_generation_runs
  ADD COLUMN price_version_id TEXT REFERENCES model_token_price_versions(id),
  ADD COLUMN currency TEXT,
  ADD COLUMN input_unit_price NUMERIC(18,6),
  ADD COLUMN output_unit_price NUMERIC(18,6),
  ADD COLUMN input_cost NUMERIC(18,6),
  ADD COLUMN output_cost NUMERIC(18,6),
  ADD COLUMN total_cost NUMERIC(18,6),
  ADD CONSTRAINT content_task_generation_runs_pricing_snapshot_check CHECK (
    (price_version_id IS NULL AND currency IS NULL AND input_unit_price IS NULL AND output_unit_price IS NULL AND input_cost IS NULL AND output_cost IS NULL AND total_cost IS NULL)
    OR
    (price_version_id IS NOT NULL AND currency = 'CNY' AND input_unit_price >= 0 AND output_unit_price >= 0 AND input_cost >= 0 AND output_cost >= 0 AND total_cost = input_cost + output_cost)
  );

CREATE INDEX model_token_price_versions_current_idx
  ON model_token_price_versions(provider, model, effective_from DESC)
  WHERE status = 'published';

CREATE OR REPLACE FUNCTION reject_model_token_price_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model token price history is immutable';
END;
$$;

CREATE TRIGGER model_token_price_versions_append_only
  BEFORE UPDATE OR DELETE ON model_token_price_versions
  FOR EACH ROW EXECUTE FUNCTION reject_model_token_price_history_mutation();
