import { fileURLToPath } from "node:url";
import { createDatabase } from "../db.js";
import { isNewPassword } from "../auth/credentials.js";
import { OperatorAuthRepository } from "./repository.js";

export async function provisionOperatorAccount(input: { databaseUrl: string; accountId: string; password: string; workFactor?: number }): Promise<boolean> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(input.accountId)) throw new Error("OPERATOR_ACCOUNT_ID is invalid");
  if (!isNewPassword(input.password)) throw new Error("OPERATOR_PASSWORD is invalid");
  const workFactor = input.workFactor ?? Number(process.env.BCRYPT_WORK_FACTOR ?? 12);
  if (!Number.isInteger(workFactor) || workFactor < 10 || workFactor > 14) throw new Error("BCRYPT_WORK_FACTOR must be between 10 and 14");
  const database = createDatabase(input.databaseUrl);
  try { return await new OperatorAuthRepository(database).provision(input.accountId, input.password, workFactor); } finally { await database.end(); }
}

export async function disableOperatorAccount(input: { databaseUrl: string; accountId: string }): Promise<boolean> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(input.accountId)) throw new Error("OPERATOR_ACCOUNT_ID is invalid");
  const database = createDatabase(input.databaseUrl);
  try { return await new OperatorAuthRepository(database).disableAccount(input.accountId); } finally { await database.end(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_URL;
  const accountId = process.env.OPERATOR_ACCOUNT_ID;
  if (!databaseUrl || !accountId) throw new Error("DATABASE_URL and OPERATOR_ACCOUNT_ID are required");
  if (process.argv.includes("--disable")) {
    const disabled = await disableOperatorAccount({ databaseUrl, accountId });
    console.log(disabled ? "Operator account disabled" : "Operator account was already disabled or does not exist");
    process.exitCode = disabled ? 0 : 1;
  } else {
    const password = process.env.OPERATOR_PASSWORD;
    if (!password) throw new Error("OPERATOR_PASSWORD is required");
    const created = await provisionOperatorAccount({ databaseUrl, accountId, password });
    console.log(created ? "Operator account provisioned" : "Operator account already exists");
  }
}
