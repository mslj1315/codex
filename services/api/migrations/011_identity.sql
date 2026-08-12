CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  login_name TEXT NOT NULL UNIQUE CHECK (login_name = lower(login_name)),
  display_name TEXT NOT NULL CHECK (length(display_name) > 0),
  password_hash TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX account_sessions_active_account_idx
  ON account_sessions (account_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE store_memberships (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'operator')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, enterprise_id, store_id),
  UNIQUE (account_id, store_id)
);

CREATE INDEX store_memberships_store_idx
  ON store_memberships (account_id, store_id)
  WHERE enabled = true;

CREATE TABLE service_operator_roles (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  role TEXT NOT NULL CHECK (role IN ('metric_catalog_operator', 'provider_feedback_viewer')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, role)
);
