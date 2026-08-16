CREATE TABLE operator_accounts (
  account_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'operator_admin'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TIMESTAMPTZ
);

CREATE TABLE operator_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES operator_accounts(account_id),
  secret_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE operator_auth_audit_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('account_provisioned', 'session_created', 'session_revoked', 'account_disabled')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX operator_sessions_active_idx ON operator_sessions (account_id, expires_at) WHERE revoked_at IS NULL;

-- PostgreSQL append-only guards
CREATE OR REPLACE FUNCTION reject_operator_account_history_rewrite()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operator accounts cannot be deleted';
  END IF;
  IF OLD.account_id IS DISTINCT FROM NEW.account_id OR OLD.role IS DISTINCT FROM NEW.role OR OLD.password_hash IS DISTINCT FROM NEW.password_hash THEN
    RAISE EXCEPTION 'operator account identity history is immutable';
  END IF;
  IF OLD.enabled = FALSE AND NEW.enabled = TRUE THEN
    RAISE EXCEPTION 'disabled operator accounts cannot be re-enabled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION reject_operator_auth_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'operator auth audit history is append-only';
END;
$$;

CREATE TRIGGER operator_accounts_history_guard
BEFORE UPDATE OR DELETE ON operator_accounts
FOR EACH ROW EXECUTE FUNCTION reject_operator_account_history_rewrite();

CREATE TRIGGER operator_auth_audit_events_append_only
BEFORE UPDATE OR DELETE ON operator_auth_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_operator_auth_audit_mutation();
