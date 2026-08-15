CREATE INDEX content_tasks_customer_queue_idx ON content_tasks(enterprise_id, store_id, actor_id, created_at DESC);
