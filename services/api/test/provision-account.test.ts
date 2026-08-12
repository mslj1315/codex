import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runProvisionAccount, type ProvisionAccountDependencies } from "../src/provision-account.js";

const environment = {
  DATABASE_URL: "postgresql://operator:private-password@postgres:5432/imports",
  PROVISION_LOGIN_NAME: "Owner",
  PROVISION_DISPLAY_NAME: "门店负责人",
  PROVISION_PASSWORD: "private-passphrase",
  PROVISION_ENTERPRISE_ID: "ent_demo",
  PROVISION_STORE_ID: "store_demo",
  PROVISION_STORE_ROLE: "owner",
  PROVISION_SERVICE_OPERATOR_ROLE: "provider_feedback_viewer"
};

describe("account provisioning CLI", () => {
  it("provisions an account, membership, and optional provider role with a non-secret result", async () => {
    const harness = createHarness();

    await expect(runProvisionAccount(environment, harness.dependencies)).resolves.toEqual({
      accountId: "account_owner", membershipGranted: true, serviceOperatorRoleGranted: true
    });
    expect(harness.events).toEqual(["database", "provision", "output", "end"]);
    expect(harness.output).toEqual([JSON.stringify({ accountId: "account_owner", membershipGranted: true, serviceOperatorRoleGranted: true })]);
    expect(harness.output.join("\n")).not.toContain(environment.PROVISION_PASSWORD);
  });

  it("rejects missing configuration before opening a database", async () => {
    const harness = createHarness();

    await expect(runProvisionAccount({ ...environment, PROVISION_PASSWORD: " " }, harness.dependencies)).rejects.toThrow("PROVISION_PASSWORD is required");
    expect(harness.events).toEqual([]);
  });

  it("always closes the database and does not output when provisioning fails", async () => {
    const failure = new Error("private database failure");
    const harness = createHarness(failure);

    await expect(runProvisionAccount(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual(["database", "provision", "end"]);
    expect(harness.output).toEqual([]);
  });

  it("exposes the provision command through the API package script", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };

    expect(packageJson.scripts["provision:account"]).toBe("tsx src/provision-account.ts");
  });
});

function createHarness(failure?: Error) {
  const state = { events: [] as string[], output: [] as string[] };
  const dependencies: ProvisionAccountDependencies = {
    createDatabase() {
      state.events.push("database");
      return { async end() { state.events.push("end"); } } as never;
    },
    createProvisioner() {
      return {
        async provision(input) {
          state.events.push("provision");
          if (failure) throw failure;
          expect(input).toMatchObject({ loginName: "owner", storeRole: "owner", serviceOperatorRole: "provider_feedback_viewer" });
          return { accountId: "account_owner", membershipGranted: true, serviceOperatorRoleGranted: true };
        }
      };
    },
    async hashPassword() { return "scrypt$v1$hash"; },
    writeOutput(value) { state.events.push("output"); state.output.push(value); }
  };
  return Object.assign(state, { dependencies });
}
