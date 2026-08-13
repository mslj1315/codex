CREATE TABLE store_content_profile_versions (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  store_name TEXT NOT NULL,
  industry_code TEXT NOT NULL,
  category_code TEXT NOT NULL,
  category_custom_name TEXT,
  province_code TEXT NOT NULL,
  city_code TEXT NOT NULL,
  district_code TEXT NOT NULL,
  detailed_address TEXT NOT NULL,
  business_district_type TEXT NOT NULL,
  business_district_note TEXT,
  operating_mode TEXT NOT NULL,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enterprise_id, store_id, version),
  UNIQUE (id, enterprise_id, store_id)
);

CREATE TABLE store_content_profile_version_locks (
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  PRIMARY KEY (enterprise_id, store_id)
);

CREATE TABLE store_operating_stages (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  effective_date DATE NOT NULL,
  primary_goal TEXT NOT NULL,
  secondary_goal TEXT,
  note TEXT,
  created_by_actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enterprise_id, store_id, effective_date),
  UNIQUE (id, enterprise_id, store_id),
  CHECK (secondary_goal IS NULL OR secondary_goal <> primary_goal)
);

CREATE INDEX store_content_profile_current_idx
  ON store_content_profile_versions (enterprise_id, store_id, version DESC);
CREATE INDEX store_operating_stages_store_idx
  ON store_operating_stages (enterprise_id, store_id, effective_date DESC);

-- Content profile and operating stage history is append-only. Corrections create a new version/stage.
CREATE OR REPLACE FUNCTION reject_content_profile_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'content planning history is append-only';
END;
$$;

CREATE TRIGGER store_content_profile_versions_append_only
BEFORE UPDATE OR DELETE ON store_content_profile_versions
FOR EACH ROW EXECUTE FUNCTION reject_content_profile_mutation();

CREATE TRIGGER store_operating_stages_append_only
BEFORE UPDATE OR DELETE ON store_operating_stages
FOR EACH ROW EXECUTE FUNCTION reject_content_profile_mutation();
