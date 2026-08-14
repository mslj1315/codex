CREATE TABLE storyboard_projects (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES content_tasks(id),
  shot_list_id TEXT NOT NULL REFERENCES content_task_shot_lists(id),
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enterprise_id, store_id, task_id, shot_list_id, actor_id)
);
CREATE INDEX storyboard_projects_scope_idx ON storyboard_projects(enterprise_id, store_id, task_id, shot_list_id, actor_id);

CREATE TABLE storyboard_project_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES storyboard_projects(id),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'final')),
  slots_json TEXT NOT NULL,
  cover_asset_id TEXT,
  cover_frame_offset_seconds DOUBLE PRECISION,
  cover_title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, version)
);
CREATE INDEX storyboard_project_versions_project_idx ON storyboard_project_versions(project_id, version DESC);
