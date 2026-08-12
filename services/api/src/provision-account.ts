import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { hashPassword } from "./auth/credentials.js";
import { AuthRepository, type StoreRole } from "./auth/repository.js";

type ServiceOperatorRole = "metric_catalog_operator" | "provider_feedback_viewer";

export interface ProvisionAccountResult {
  accountId: string;
  membershipGranted: boolean;
  serviceOperatorRoleGranted: boolean;
}

export interface AccountProvisioner {
  provision(input: {
    loginName: string;
    displayName: string;
    passwordHash: string;
    enterpriseId: string;
    storeId: string;
    storeRole: StoreRole;
    serviceOperatorRole?: ServiceOperatorRole;
  }): Promise<ProvisionAccountResult>;
}

export interface ProvisionAccountDependencies {
  createDatabase(databaseUrl: string): Database & { end(): Promise<void> };
  createProvisioner(database: Database): AccountProvisioner;
  hashPassword(password: string): Promise<string>;
  writeOutput(value: string): void;
}

const defaults: ProvisionAccountDependencies = {
  createDatabase,
  createProvisioner(database) { return new AuthRepository(database); },
  hashPassword,
  writeOutput(value) { console.log(value); }
};

export async function runProvisionAccount(
  environment: Record<string, string | undefined> = process.env,
  dependencies: ProvisionAccountDependencies = defaults
): Promise<ProvisionAccountResult> {
  const input = readInput(environment);
  const database = dependencies.createDatabase(input.databaseUrl);
  try {
    const result = await dependencies.createProvisioner(database).provision({
      loginName: input.loginName,
      displayName: input.displayName,
      passwordHash: await dependencies.hashPassword(input.password),
      enterpriseId: input.enterpriseId,
      storeId: input.storeId,
      storeRole: input.storeRole,
      serviceOperatorRole: input.serviceOperatorRole
    });
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await database.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runProvisionAccount();
  } catch {
    console.error("Account provisioning failed");
    process.exitCode = 1;
  }
}

function readInput(environment: Record<string, string | undefined>) {
  const databaseUrl = required(environment, "DATABASE_URL");
  const loginName = required(environment, "PROVISION_LOGIN_NAME").toLowerCase();
  const displayName = required(environment, "PROVISION_DISPLAY_NAME");
  const password = required(environment, "PROVISION_PASSWORD");
  const enterpriseId = identifier(required(environment, "PROVISION_ENTERPRISE_ID"), "PROVISION_ENTERPRISE_ID");
  const storeId = identifier(required(environment, "PROVISION_STORE_ID"), "PROVISION_STORE_ID");
  const storeRole = role(required(environment, "PROVISION_STORE_ROLE"));
  const configuredRole = environment.PROVISION_SERVICE_OPERATOR_ROLE?.trim();
  const serviceOperatorRole = configuredRole === undefined || configuredRole === "" ? undefined : providerRole(configuredRole);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(loginName)) throw new Error("PROVISION_LOGIN_NAME is invalid");
  return { databaseUrl, loginName, displayName, password, enterpriseId, storeId, storeRole, serviceOperatorRole };
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

function role(value: string): StoreRole {
  if (value === "owner" || value === "operator") return value;
  throw new Error("PROVISION_STORE_ROLE is invalid");
}

function providerRole(value: string): ServiceOperatorRole {
  if (value === "metric_catalog_operator" || value === "provider_feedback_viewer") return value;
  throw new Error("PROVISION_SERVICE_OPERATOR_ROLE is invalid");
}
