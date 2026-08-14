CREATE TABLE content_templates (
  id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','submitted','published','returned','disabled')),
  content_json text NOT NULL, constraints_json text NOT NULL, fallback_scope_json text NOT NULL,
  return_reason text, created_by_actor_id text NOT NULL, reviewed_by_actor_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE content_review_rules (
  id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','submitted','published','returned','disabled')),
  rule_type text NOT NULL, severity text NOT NULL CHECK (severity IN ('block','high','warning','notice')),
  patterns_json text NOT NULL, return_reason text, created_by_actor_id text NOT NULL,
  reviewed_by_actor_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- PostgreSQL append-only guards
CREATE OR REPLACE FUNCTION reject_published_content_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'published' AND TG_TABLE_NAME = 'content_templates' AND
    (NEW.name IS DISTINCT FROM OLD.name OR NEW.content_json IS DISTINCT FROM OLD.content_json OR
     NEW.constraints_json IS DISTINCT FROM OLD.constraints_json OR NEW.fallback_scope_json IS DISTINCT FROM OLD.fallback_scope_json)
  THEN RAISE EXCEPTION 'Published template versions are immutable'; END IF;
  IF OLD.status = 'published' AND TG_TABLE_NAME = 'content_review_rules' AND
    (NEW.name IS DISTINCT FROM OLD.name OR NEW.rule_type IS DISTINCT FROM OLD.rule_type OR
     NEW.severity IS DISTINCT FROM OLD.severity OR NEW.patterns_json IS DISTINCT FROM OLD.patterns_json)
  THEN RAISE EXCEPTION 'Published rule versions are immutable'; END IF;
  IF TG_OP = 'DELETE' AND OLD.status = 'published' THEN RAISE EXCEPTION 'Published records cannot be deleted'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER content_templates_immutable BEFORE UPDATE OR DELETE ON content_templates
FOR EACH ROW EXECUTE FUNCTION reject_published_content_mutation();
CREATE TRIGGER content_review_rules_immutable BEFORE UPDATE OR DELETE ON content_review_rules
FOR EACH ROW EXECUTE FUNCTION reject_published_content_mutation();
