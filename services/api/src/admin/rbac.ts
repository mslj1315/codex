import type { Database } from "../db.js";

export const INTERNAL_PERMISSION_CODES = [
  "customer_accounts.read",
  "customer_accounts.create",
  "customer_accounts.reset_password",
  "customer_accounts.disable",
  "content_templates.read",
  "content_templates.edit",
  "content_templates.publish",
  "review_rules.read",
  "review_rules.edit",
  "review_rules.publish",
  "model_configs.read",
  "model_configs.manage",
  "model_assignments.manage",
  "model_pricing.read",
  "model_pricing.manage",
  "model_usage.read",
  "internal_accounts.read",
  "internal_accounts.manage",
  "roles.manage",
  "audit.read"
] as const;

export type InternalPermission = typeof INTERNAL_PERMISSION_CODES[number];

export class InternalPermissionRepository {
  constructor(private readonly database: Database) {}

  async permissionsFor(accountId: string): Promise<Set<string>> {
    const roles = await this.database.query<{ code: string }>(
      `SELECT role.code FROM internal_account_roles AS assignment
       JOIN internal_roles AS role ON role.id = assignment.role_id
       WHERE assignment.account_id = $1 AND assignment.enabled = true AND role.enabled = true`,
      [accountId]
    );
    if (roles.rows.some((role) => role.code === "super_admin")) return new Set(INTERNAL_PERMISSION_CODES);
    const result = await this.database.query<{ permission_code: string }>(
      `SELECT DISTINCT permission.permission_code FROM internal_account_roles AS assignment
       JOIN internal_roles AS role ON role.id = assignment.role_id
       JOIN internal_role_permissions AS permission ON permission.role_id = role.id
       WHERE assignment.account_id = $1 AND assignment.enabled = true AND role.enabled = true`,
      [accountId]
    );
    return new Set(result.rows.map((row) => row.permission_code).filter(isInternalPermission));
  }

  async hasEnabledInternalRole(accountId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1 FROM internal_account_roles AS assignment
       JOIN internal_roles AS role ON role.id = assignment.role_id
       WHERE assignment.account_id = $1 AND assignment.enabled = true AND role.enabled = true`,
      [accountId]
    );
    return (result.rowCount ?? 0) > 0;
  }
}

export function effectiveInternalPermissions(input: {
  superAdmin: boolean;
  rolePermissions: readonly (readonly string[])[];
}): Set<string> {
  if (input.superAdmin) return new Set(INTERNAL_PERMISSION_CODES);
  return new Set(input.rolePermissions.flat());
}

export async function requireInternalPermission<T>(
  permissions: ReadonlySet<string>,
  permission: string,
  protectedWork: () => Promise<T> | T
): Promise<T> {
  if (!permissions.has(permission)) throw new InternalAuthorizationError("Internal permission is not authorized");
  return protectedWork();
}

export class InternalAuthorizationError extends Error {}

function isInternalPermission(value: string): value is InternalPermission {
  return (INTERNAL_PERMISSION_CODES as readonly string[]).includes(value);
}
