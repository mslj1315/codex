import { fileURLToPath } from "node:url";
import { AuthRepository, type ServiceOperatorRole } from "./auth/repository.js";
import { createDatabase, type Database } from "./db.js";

export interface GrantServiceRoleDatabase extends Database {
  end(): Promise<void>;
}

export interface ServiceRoleGrantRepository {
  grantServiceOperatorRole(accountId: string, role: ServiceOperatorRole): Promise<boolean>;
}

export interface GrantServiceRoleDependencies {
  createDatabase(databaseUrl: string): GrantServiceRoleDatabase;
  createRepository(database: GrantServiceRoleDatabase): ServiceRoleGrantRepository;
  writeOutput(value: string): void;
}

const defaults: GrantServiceRoleDependencies = {
  createDatabase,
  createRepository(database) { return new AuthRepository(database); },
  writeOutput(value) { console.log(value); }
};

export interface GrantServiceRoleResult {
  accountId: string;
  role: ServiceOperatorRole;
  roleGranted: true;
}

export async function runGrantServiceRole(
  environment: Record<string, string | undefined> = process.env,
  dependencies: GrantServiceRoleDependencies = defaults
): Promise<GrantServiceRoleResult> {
  const input = readInput(environment);
  const database = dependencies.createDatabase(input.databaseUrl);
  try {
    const roleGranted = await dependencies.createRepository(database).grantServiceOperatorRole(input.accountId, input.role);
    if (!roleGranted) throw new Error("Account is not eligible for a service role grant");
    const result: GrantServiceRoleResult = { accountId: input.accountId, role: input.role, roleGranted: true };
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await database.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runGrantServiceRole();
  } catch {
    console.error("Service role grant failed");
    process.exitCode = 1;
  }
}

function readInput(environment: Record<string, string | undefined>) {
  const databaseUrl = required(environment, "DATABASE_URL");
  const accountId = identifier(required(environment, "GRANT_ACCOUNT_ID"), "GRANT_ACCOUNT_ID");
  const role = serviceOperatorRole(required(environment, "GRANT_SERVICE_OPERATOR_ROLE"));
  return { databaseUrl, accountId, role };
}

function required(environment: Record<string, string | undefined>, key: string): string {
  const value = environment[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function identifier(value: string, key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error(`${key} is invalid`);
  return value;
}

function serviceOperatorRole(value: string): ServiceOperatorRole {
  if (value === "metric_catalog_operator" || value === "provider_feedback_viewer" || value === "provider_customer_metadata_editor") return value;
  throw new Error("GRANT_SERVICE_OPERATOR_ROLE is invalid");
}
