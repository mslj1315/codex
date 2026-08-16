CREATE TABLE storyboard_render_jobs (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES content_tasks(id),
  shot_list_id TEXT NOT NULL REFERENCES content_task_shot_lists(id),
  project_id TEXT NOT NULL REFERENCES storyboard_projects(id),
  project_version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'final')),
  state TEXT NOT NULL CHECK (state IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  output_object_key TEXT UNIQUE,
  output_expires_at TIMESTAMPTZ,
  cover_candidates_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CHECK ((state = 'succeeded' AND output_object_key IS NOT NULL AND output_expires_at IS NOT NULL AND cover_candidates_json IS NOT NULL) OR state <> 'succeeded')
);
CREATE INDEX storyboard_render_jobs_project_idx ON storyboard_render_jobs(project_id, created_at DESC);
CREATE UNIQUE INDEX storyboard_render_jobs_one_active_project ON storyboard_render_jobs(project_id) WHERE state IN ('queued', 'processing');
