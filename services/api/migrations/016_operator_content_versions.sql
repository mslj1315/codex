CREATE TABLE operator_content_template_items (logical_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE operator_content_template_versions (
  id text PRIMARY KEY, logical_id text NOT NULL REFERENCES operator_content_template_items(logical_id), version integer NOT NULL,
  name text NOT NULL, status text NOT NULL CHECK (status IN ('draft','published','disabled')),
  content_json text NOT NULL, constraints_json text NOT NULL, fallback_scope_json text NOT NULL,
  actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(logical_id, version)
);
CREATE TABLE operator_content_rule_items (logical_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE operator_content_rule_versions (
  id text PRIMARY KEY, logical_id text NOT NULL REFERENCES operator_content_rule_items(logical_id), version integer NOT NULL,
  name text NOT NULL, rule_type text NOT NULL, patterns_json text NOT NULL, semantic_categories_json text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('block','high','warning','notice')), platform text NOT NULL, scope text NOT NULL, guidance text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','published','disabled')), actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(logical_id, version)
);
CREATE TABLE operator_content_audit_events (
  id text PRIMARY KEY, content_kind text NOT NULL CHECK (content_kind IN ('template','rule')), logical_id text NOT NULL,
  version integer NOT NULL, event_type text NOT NULL CHECK (event_type IN ('draft_created','draft_saved','published','disabled')),
  actor_id text NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Copy prototype records as v1 logical versions. This migration is safe when 014 has no rows.
INSERT INTO operator_content_template_items(logical_id) SELECT id FROM content_templates ON CONFLICT DO NOTHING;
INSERT INTO operator_content_template_versions(id,logical_id,version,name,status,content_json,constraints_json,fallback_scope_json,actor_id,created_at)
SELECT id,id,1, name, CASE WHEN status='published' THEN 'published' WHEN status='disabled' THEN 'disabled' ELSE 'draft' END, content_json,constraints_json,fallback_scope_json,created_by_actor_id,created_at FROM content_templates ON CONFLICT DO NOTHING;
INSERT INTO operator_content_rule_items(logical_id) SELECT id FROM content_review_rules ON CONFLICT DO NOTHING;
INSERT INTO operator_content_rule_versions(id,logical_id,version,name,rule_type,patterns_json,semantic_categories_json,severity,platform,scope,guidance,status,actor_id,created_at)
SELECT id,id,1,name,rule_type,patterns_json,'[]',severity,'douyin','all_copy','',CASE WHEN status='published' THEN 'published' WHEN status='disabled' THEN 'disabled' ELSE 'draft' END,created_by_actor_id,created_at FROM content_review_rules ON CONFLICT DO NOTHING;

-- PostgreSQL append-only guards
CREATE OR REPLACE FUNCTION reject_operator_content_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'operator_content_audit_events' THEN RAISE EXCEPTION 'operator content audit history is append-only'; END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'published' THEN RAISE EXCEPTION 'published versions cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status <> 'disabled' THEN RAISE EXCEPTION 'published versions are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'published' AND NEW.status = 'disabled' AND row(NEW.*) IS DISTINCT FROM row(OLD.*) THEN
    IF TG_TABLE_NAME = 'operator_content_template_versions' AND (NEW.name IS DISTINCT FROM OLD.name OR NEW.content_json IS DISTINCT FROM OLD.content_json OR NEW.constraints_json IS DISTINCT FROM OLD.constraints_json OR NEW.fallback_scope_json IS DISTINCT FROM OLD.fallback_scope_json) THEN RAISE EXCEPTION 'published versions are immutable'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER operator_template_versions_immutable BEFORE UPDATE OR DELETE ON operator_content_template_versions FOR EACH ROW EXECUTE FUNCTION reject_operator_content_history_mutation();
CREATE TRIGGER operator_rule_versions_immutable BEFORE UPDATE OR DELETE ON operator_content_rule_versions FOR EACH ROW EXECUTE FUNCTION reject_operator_content_history_mutation();
CREATE TRIGGER operator_content_audit_append_only BEFORE UPDATE OR DELETE ON operator_content_audit_events FOR EACH ROW EXECUTE FUNCTION reject_operator_content_history_mutation();
