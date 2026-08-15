CREATE TABLE internal_permissions (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE internal_roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE internal_role_permissions (
  role_id TEXT NOT NULL REFERENCES internal_roles (id),
  permission_code TEXT NOT NULL REFERENCES internal_permissions (code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE internal_account_roles (
  account_id TEXT NOT NULL REFERENCES accounts (id),
  role_id TEXT NOT NULL REFERENCES internal_roles (id),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, role_id)
);

CREATE INDEX internal_account_roles_enabled_account_idx
  ON internal_account_roles (account_id) WHERE enabled = true;

CREATE TABLE internal_audit_events (
  id TEXT PRIMARY KEY,
  actor_account_id TEXT NOT NULL REFERENCES accounts (id),
  action_code TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO internal_permissions (code, display_name) VALUES
  ('customer_accounts.read', 'Customer account read'),
  ('customer_accounts.create', 'Customer account create'),
  ('customer_accounts.reset_password', 'Customer account reset password'),
  ('customer_accounts.disable', 'Customer account disable'),
  ('content_templates.read', 'Content template read'),
  ('content_templates.edit', 'Content template edit'),
  ('content_templates.publish', 'Content template publish'),
  ('review_rules.read', 'Review rule read'),
  ('review_rules.edit', 'Review rule edit'),
  ('review_rules.publish', 'Review rule publish'),
  ('model_configs.read', 'Model configuration read'),
  ('model_configs.manage', 'Model configuration manage'),
  ('model_assignments.manage', 'Model assignment manage'),
  ('model_pricing.read', 'Model pricing read'),
  ('model_pricing.manage', 'Model pricing manage'),
  ('model_usage.read', 'Model aggregate usage read'),
  ('internal_accounts.read', 'Internal account read'),
  ('internal_accounts.manage', 'Internal account manage'),
  ('roles.manage', 'Role and permission manage'),
  ('audit.read', 'Internal audit read');

INSERT INTO internal_roles (id, code, display_name) VALUES
  ('internal-role-super-admin', 'super_admin', 'Super administrator');

-- PostgreSQL append-only guards
CREATE OR REPLACE FUNCTION reject_internal_audit_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'internal audit events are append-only';
END;
$$;

CREATE TRIGGER internal_audit_events_append_only
BEFORE UPDATE OR DELETE ON internal_audit_events
FOR EACH ROW EXECUTE FUNCTION reject_internal_audit_event_mutation();

CREATE OR REPLACE FUNCTION reject_internal_role_code_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.code IS DISTINCT FROM NEW.code THEN
    RAISE EXCEPTION 'internal role machine code is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER internal_roles_code_immutable
BEFORE UPDATE ON internal_roles
FOR EACH ROW EXECUTE FUNCTION reject_internal_role_code_mutation();
