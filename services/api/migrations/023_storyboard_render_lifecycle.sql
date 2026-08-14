ALTER TABLE storyboard_render_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);
ALTER TABLE storyboard_render_jobs ADD COLUMN next_attempt_at TIMESTAMPTZ;
ALTER TABLE storyboard_render_jobs ADD COLUMN lease_expires_at TIMESTAMPTZ;
ALTER TABLE storyboard_render_jobs ADD COLUMN cancelled_at TIMESTAMPTZ;
ALTER TABLE storyboard_render_jobs ADD COLUMN deleted_at TIMESTAMPTZ;
CREATE TABLE storyboard_render_output_deletions (
  id TEXT PRIMARY KEY,
  render_job_id TEXT NOT NULL REFERENCES storyboard_render_jobs(id),
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('customer_deleted','retention_expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX storyboard_render_jobs_claim_idx ON storyboard_render_jobs(state, next_attempt_at, created_at) WHERE state='queued';
