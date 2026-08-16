CREATE TABLE storyboard_render_artifacts (
  id TEXT PRIMARY KEY,
  render_job_id TEXT NOT NULL REFERENCES storyboard_render_jobs(id),
  object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('video','cover')),
  deleted_at TIMESTAMPTZ,
  cleanup_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (cleanup_attempt_count >= 0),
  next_cleanup_attempt_at TIMESTAMPTZ,
  cleanup_lease_expires_at TIMESTAMPTZ,
  last_cleanup_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (render_job_id, kind, object_key)
);
CREATE INDEX storyboard_render_artifacts_cleanup_idx ON storyboard_render_artifacts(next_cleanup_attempt_at, created_at) WHERE deleted_at IS NULL;
