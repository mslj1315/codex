CREATE TABLE douyin_data_connections (
  id text PRIMARY KEY,
  enterprise_id text NOT NULL,
  store_id text NOT NULL,
  connection_type text NOT NULL CHECK (connection_type IN ('content_account', 'life_service_store')),
  official_subject_id text NOT NULL,
  capabilities_json text NOT NULL,
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'reauthorization_required', 'disconnected')),
  diagnostic_category text,
  version integer NOT NULL DEFAULT 1,
  last_success_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enterprise_id, store_id, connection_type)
);

CREATE TABLE douyin_oauth_states (
  id text PRIMARY KEY,
  state_hash text NOT NULL UNIQUE,
  enterprise_id text NOT NULL,
  store_id text NOT NULL,
  connection_type text NOT NULL CHECK (connection_type IN ('content_account', 'life_service_store')),
  redirect_path text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX douyin_oauth_states_consumption_scope_idx
  ON douyin_oauth_states (state_hash, enterprise_id, store_id)
  WHERE consumed_at IS NULL;

CREATE TABLE douyin_sync_runs (
  id text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES douyin_data_connections(id),
  trigger_source text NOT NULL CHECK (trigger_source IN ('daily', 'manual')),
  status text NOT NULL CHECK (status IN ('started', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at timestamptz,
  diagnostic_category text
);
