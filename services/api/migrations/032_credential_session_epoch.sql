ALTER TABLE accounts
  ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0);

ALTER TABLE account_sessions
  ADD COLUMN credential_version INTEGER NOT NULL DEFAULT 0 CHECK (credential_version >= 0);
