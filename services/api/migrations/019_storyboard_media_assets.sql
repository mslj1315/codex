CREATE TABLE storyboard_media_assets (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES content_tasks(id),
  shot_list_id TEXT NOT NULL REFERENCES content_task_shot_lists(id),
  project_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes > 0 AND expected_size_bytes <= 524288000),
  size_bytes BIGINT,
  duration_seconds INTEGER,
  status TEXT NOT NULL CHECK (status IN ('upload_pending', 'accepted', 'deleted')),
  expires_at TIMESTAMPTZ NOT NULL,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((status = 'upload_pending' AND size_bytes IS NULL AND duration_seconds IS NULL AND deleted_at IS NULL) OR (status = 'accepted' AND size_bytes IS NOT NULL AND duration_seconds IS NOT NULL AND deleted_at IS NULL) OR (status = 'deleted' AND deleted_at IS NOT NULL))
);
CREATE INDEX storyboard_media_assets_scope_idx ON storyboard_media_assets(enterprise_id, store_id, task_id, shot_list_id, project_id);

CREATE TABLE storyboard_media_upload_grants (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL UNIQUE REFERENCES storyboard_media_assets(id),
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES content_tasks(id),
  shot_list_id TEXT NOT NULL REFERENCES content_task_shot_lists(id),
  project_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX storyboard_media_upload_grants_scope_idx ON storyboard_media_upload_grants(asset_id, enterprise_id, store_id, project_id) WHERE consumed_at IS NULL;

CREATE TABLE storyboard_media_asset_deletions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES storyboard_media_assets(id),
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('customer_deleted', 'retention_expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
