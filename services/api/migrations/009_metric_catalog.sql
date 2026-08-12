CREATE TABLE metric_catalog_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL UNIQUE CHECK (version_number > 0),
  state TEXT NOT NULL CHECK (state IN ('draft', 'published', 'retired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX metric_catalog_one_published_idx
  ON metric_catalog_versions (state)
  WHERE state = 'published';

CREATE TABLE metric_definitions (
  metric_catalog_version_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  value_kind TEXT NOT NULL CHECK (value_kind IN ('amount', 'count', 'ratio')),
  storage_unit TEXT NOT NULL CHECK (storage_unit IN ('cents', 'count', 'basis_points')),
  allow_negative BOOLEAN NOT NULL,
  require_positive BOOLEAN NOT NULL,
  usable_for_readiness BOOLEAN NOT NULL,
  usable_for_diagnostic BOOLEAN NOT NULL,
  usable_for_verification BOOLEAN NOT NULL,
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (metric_catalog_version_id, metric_key),
  FOREIGN KEY (metric_catalog_version_id) REFERENCES metric_catalog_versions (id),
  CHECK ((value_kind = 'amount' AND storage_unit = 'cents')
      OR (value_kind = 'count' AND storage_unit = 'count')
      OR (value_kind = 'ratio' AND storage_unit = 'basis_points')),
  CHECK (NOT require_positive OR NOT allow_negative),
  UNIQUE (metric_catalog_version_id, metric_key)
);

INSERT INTO metric_catalog_versions (id, version_number, state, published_at)
VALUES ('metric_catalog_v1', 1, 'published', CURRENT_TIMESTAMP);

INSERT INTO metric_definitions (
  metric_catalog_version_id, metric_key, display_name, value_kind, storage_unit,
  allow_negative, require_positive, usable_for_readiness,
  usable_for_diagnostic, usable_for_verification, enabled
) VALUES
  ('metric_catalog_v1', 'revenue', 'Revenue', 'amount', 'cents', false, false, true, true, true, true),
  ('metric_catalog_v1', 'orders', 'Orders', 'count', 'count', false, true, true, false, true, true),
  ('metric_catalog_v1', 'average_spend', 'Average spend', 'amount', 'cents', false, true, true, false, false, true),
  ('metric_catalog_v1', 'package_sales', 'Package sales', 'amount', 'cents', false, true, false, false, false, true),
  ('metric_catalog_v1', 'package_redemptions', 'Package redemptions', 'count', 'count', false, true, false, false, false, true),
  ('metric_catalog_v1', 'refunds', 'Refunds', 'amount', 'cents', false, false, false, false, false, true),
  ('metric_catalog_v1', 'promotion_spend', 'Promotion spend', 'amount', 'cents', false, false, false, false, false, true);

ALTER TABLE fact_versions ADD COLUMN metric_catalog_version_id TEXT DEFAULT 'metric_catalog_v1';

UPDATE fact_versions
SET metric_catalog_version_id = 'metric_catalog_v1'
WHERE metric_catalog_version_id IS NULL;

ALTER TABLE fact_versions
  ALTER COLUMN metric_catalog_version_id SET NOT NULL;

ALTER TABLE fact_versions
  ADD CONSTRAINT fact_versions_metric_catalog_version_fk
  FOREIGN KEY (metric_catalog_version_id) REFERENCES metric_catalog_versions (id);
