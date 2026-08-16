ALTER TABLE storyboard_render_jobs ADD COLUMN lease_token TEXT;
CREATE INDEX storyboard_render_jobs_lease_idx ON storyboard_render_jobs(id, state, lease_token, lease_expires_at);
