ALTER TABLE service_operator_roles DROP CONSTRAINT service_operator_roles_role_check;
ALTER TABLE service_operator_roles ADD CONSTRAINT service_operator_roles_role_check
  CHECK (role IN ('metric_catalog_operator', 'provider_feedback_viewer', 'provider_customer_metadata_editor', 'model_pricing_operator'));
