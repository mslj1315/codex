CREATE TABLE content_tasks (
  id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL, profile_snapshot_json TEXT NOT NULL, stage_snapshot_json TEXT NOT NULL, template_snapshot_json TEXT NOT NULL DEFAULT '[]',
  inspiration TEXT, persona TEXT NOT NULL, content_type TEXT NOT NULL, style TEXT NOT NULL,
  commercial_level INTEGER NOT NULL CHECK (commercial_level BETWEEN 0 AND 3), status TEXT NOT NULL,
  confirmed_copy_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE content_task_topics (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES content_tasks(id), position INTEGER NOT NULL,
  title TEXT NOT NULL, angle TEXT NOT NULL, product_reference TEXT NOT NULL, goal_reference TEXT NOT NULL,
  commercial_level INTEGER NOT NULL CHECK (commercial_level BETWEEN 0 AND 3), created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, position)
);
CREATE TABLE content_task_copies (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES content_tasks(id), topic_id TEXT NOT NULL REFERENCES content_task_topics(id),
  position INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, strategy TEXT NOT NULL,
  product_reference TEXT NOT NULL, goal_reference TEXT NOT NULL, commercial_level INTEGER NOT NULL CHECK (commercial_level BETWEEN 0 AND 3),
  version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'draft', confirmed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, topic_id, position)
);
CREATE TABLE content_task_shot_lists (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES content_tasks(id), copy_id TEXT NOT NULL REFERENCES content_task_copies(id),
  shots_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(task_id, copy_id)
);
CREATE TABLE content_task_copy_versions (
  id TEXT PRIMARY KEY, copy_id TEXT NOT NULL REFERENCES content_task_copies(id), version INTEGER NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(copy_id, version)
);
CREATE TABLE content_task_generation_runs (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES content_tasks(id), kind TEXT NOT NULL,
  subject_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  template_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded','failed')),
  usage_json TEXT, latency_ms INTEGER, failure_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE content_task_generation_claims (
  task_id TEXT NOT NULL REFERENCES content_tasks(id), kind TEXT NOT NULL,
  subject_id TEXT NOT NULL DEFAULT '',
  claim_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (task_id, kind, subject_id)
);
CREATE TABLE content_task_copy_reviews (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES content_tasks(id), copy_id TEXT NOT NULL REFERENCES content_task_copies(id),
  copy_version INTEGER NOT NULL, content_digest TEXT NOT NULL,
  rule_snapshot_json TEXT NOT NULL, provider TEXT, model TEXT, prompt_version TEXT, result_json TEXT NOT NULL,
  approved BOOLEAN NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX content_task_one_confirmed_copy ON content_task_copies(task_id) WHERE status='confirmed';
CREATE INDEX content_tasks_scope_idx ON content_tasks(enterprise_id, store_id, created_at DESC);

-- PostgreSQL append-only guards: task inputs, generated alternatives, and frozen shot lists are append-only history.
CREATE OR REPLACE FUNCTION reject_content_task_history_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'content_tasks' AND TG_OP = 'UPDATE' AND NEW.id = OLD.id AND NEW.enterprise_id = OLD.enterprise_id AND NEW.store_id = OLD.store_id AND NEW.actor_id = OLD.actor_id AND NEW.profile_version = OLD.profile_version AND NEW.profile_snapshot_json = OLD.profile_snapshot_json AND NEW.stage_snapshot_json = OLD.stage_snapshot_json AND NEW.template_snapshot_json = OLD.template_snapshot_json AND NEW.inspiration IS NOT DISTINCT FROM OLD.inspiration AND NEW.persona = OLD.persona AND NEW.content_type = OLD.content_type AND NEW.style = OLD.style AND NEW.commercial_level = OLD.commercial_level AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'content task history is immutable';
END;
$$;
CREATE OR REPLACE FUNCTION reject_confirmed_copy_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'confirmed' THEN RAISE EXCEPTION 'confirmed copy is immutable'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER content_tasks_append_only BEFORE UPDATE OR DELETE ON content_tasks FOR EACH ROW EXECUTE FUNCTION reject_content_task_history_mutation();
CREATE TRIGGER content_task_topics_append_only BEFORE UPDATE OR DELETE ON content_task_topics FOR EACH ROW EXECUTE FUNCTION reject_content_task_history_mutation();
CREATE TRIGGER content_task_copy_versions_append_only BEFORE UPDATE OR DELETE ON content_task_copy_versions FOR EACH ROW EXECUTE FUNCTION reject_content_task_history_mutation();
CREATE TRIGGER content_task_shot_lists_append_only BEFORE UPDATE OR DELETE ON content_task_shot_lists FOR EACH ROW EXECUTE FUNCTION reject_content_task_history_mutation();
CREATE TRIGGER content_task_confirmed_copies_immutable BEFORE UPDATE OR DELETE ON content_task_copies FOR EACH ROW EXECUTE FUNCTION reject_confirmed_copy_mutation();
CREATE TRIGGER content_task_generation_runs_append_only BEFORE UPDATE OR DELETE ON content_task_generation_runs FOR EACH ROW EXECUTE FUNCTION reject_content_task_history_mutation();
CREATE TRIGGER content_task_copy_reviews_append_only BEFORE UPDATE OR DELETE ON content_task_copy_reviews FOR EACH ROW EXECUTE FUNCTION reject_content_task_history_mutation();
