CREATE TABLE storyboard_render_cover_selections (
  project_id TEXT NOT NULL REFERENCES storyboard_projects(id),
  project_version INTEGER NOT NULL,
  render_job_id TEXT NOT NULL REFERENCES storyboard_render_jobs(id),
  artifact_id TEXT NOT NULL REFERENCES storyboard_render_artifacts(id),
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, project_version)
);
