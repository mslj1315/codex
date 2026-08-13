ALTER TABLE service_operator_roles
  DROP CONSTRAINT service_operator_roles_role_check;

ALTER TABLE service_operator_roles
  ADD CONSTRAINT service_operator_roles_role_check
  CHECK (role IN ('metric_catalog_operator', 'provider_feedback_viewer', 'provider_customer_metadata_editor'));

CREATE TABLE provider_customer_metadata (
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_alias TEXT,
  provider_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (enterprise_id, store_id),
  CHECK (customer_alias IS NULL OR length(customer_alias) BETWEEN 1 AND 120),
  CHECK (provider_note IS NULL OR length(provider_note) BETWEEN 1 AND 2000),
  CHECK (customer_alias IS NOT NULL OR provider_note IS NOT NULL)
);
