ALTER TABLE action_cards
  ADD COLUMN verification_metric_keys TEXT;

UPDATE action_cards
SET verification_metric_keys = '["revenue","orders"]'
WHERE verification_metric_keys IS NULL;

ALTER TABLE action_cards
  ALTER COLUMN verification_metric_keys SET DEFAULT '["revenue","orders"]',
  ALTER COLUMN verification_metric_keys SET NOT NULL;
