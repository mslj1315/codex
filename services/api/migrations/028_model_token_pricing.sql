CREATE TABLE model_token_price_versions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_cny_per_million_tokens NUMERIC(18,6) NOT NULL CHECK (input_cny_per_million_tokens >= 0),
  output_cny_per_million_tokens NUMERIC(18,6) NOT NULL CHECK (output_cny_per_million_tokens >= 0),
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, model, effective_from),
  CHECK (
    (status IN ('draft', 'published') AND effective_to IS NULL)
    OR (status = 'retired' AND effective_to IS NOT NULL AND effective_to >= effective_from)
  )
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
    (price_version_id IS NOT NULL AND currency = 'CNY' AND input_unit_price IS NOT NULL AND output_unit_price IS NOT NULL AND input_cost IS NOT NULL AND output_cost IS NOT NULL AND total_cost IS NOT NULL AND input_unit_price >= 0 AND output_unit_price >= 0 AND input_cost >= 0 AND output_cost >= 0 AND total_cost = input_cost + output_cost)
  );

CREATE INDEX model_token_price_versions_current_idx
  ON model_token_price_versions(provider, model, effective_from DESC)
  WHERE status = 'published';

CREATE OR REPLACE FUNCTION reject_model_token_price_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'model token price history is immutable';
  END IF;
  IF OLD.status = 'draft' THEN
    IF NEW.status IN ('draft', 'published') AND NEW.effective_to IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'model token price draft has an invalid lifecycle transition';
  END IF;
  IF OLD.status = 'published' AND NEW.status = 'retired'
    AND NEW.id = OLD.id
    AND NEW.provider = OLD.provider
    AND NEW.model = OLD.model
    AND NEW.input_cny_per_million_tokens = OLD.input_cny_per_million_tokens
    AND NEW.output_cny_per_million_tokens = OLD.output_cny_per_million_tokens
    AND NEW.effective_from = OLD.effective_from
    AND NEW.created_at = OLD.created_at
    AND NEW.effective_to IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'model token price history is immutable';
END;
$$;

CREATE TRIGGER model_token_price_versions_append_only
  BEFORE UPDATE OR DELETE ON model_token_price_versions
  FOR EACH ROW EXECUTE FUNCTION reject_model_token_price_history_mutation();
