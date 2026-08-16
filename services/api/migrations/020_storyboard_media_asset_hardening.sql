CREATE TABLE storyboard_media_upload_projects (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES content_tasks(id),
  shot_list_id TEXT NOT NULL REFERENCES content_task_shot_lists(id),
  actor_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (enterprise_id, store_id, task_id, shot_list_id, actor_id)
);
ALTER TABLE storyboard_media_assets ADD COLUMN storage_upload_id TEXT;
ALTER TABLE storyboard_media_assets ADD COLUMN storage_etag TEXT;
ALTER TABLE storyboard_media_assets ADD COLUMN storage_version TEXT;
