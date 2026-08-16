CREATE TABLE model_configurations (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('deepseek', 'qwen', 'openai_responses')),
  model TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  api_key_nonce TEXT NOT NULL,
  api_key_auth_tag TEXT NOT NULL,
  api_key_suffix TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX model_configurations_single_default_idx
  ON model_configurations (is_default) WHERE is_default = true;

CREATE TABLE customer_model_assignments (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  model_configuration_id TEXT NOT NULL REFERENCES model_configurations (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enterprise_id, store_id)
);

CREATE INDEX customer_model_assignments_configuration_idx ON customer_model_assignments (model_configuration_id);
