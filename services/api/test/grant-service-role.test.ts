import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  runGrantServiceRole,
  type GrantServiceRoleDependencies
} from "../src/grant-service-role.js";

const environment = {
  DATABASE_URL: "postgresql://operator:private-password@postgres:5432/imports",
  GRANT_ACCOUNT_ID: "account_editor",
  GRANT_SERVICE_OPERATOR_ROLE: "provider_customer_metadata_editor"
};

describe("service role grant CLI", () => {
  it("grants one validated role and writes a non-secret result", async () => {
    const harness = createHarness();

    await expect(runGrantServiceRole(environment, harness.dependencies)).resolves.toEqual({
      accountId: "account_editor",
      role: "provider_customer_metadata_editor",
      roleGranted: true
    });
    expect(harness.events).toEqual(["database", "grant", "output", "end"]);
    expect(harness.output).toEqual([JSON.stringify({
      accountId: "account_editor", role: "provider_customer_metadata_editor", roleGranted: true
    })]);
    expect(harness.output.join("\n")).not.toContain(environment.DATABASE_URL);
  });

  it.each([
    ["GRANT_ACCOUNT_ID", "invalid account"],
    ["GRANT_SERVICE_OPERATOR_ROLE", "administrator"]
  ] as const)("rejects invalid %s before opening a database", async (key, value) => {
    const harness = createHarness();

    await expect(runGrantServiceRole({ ...environment, [key]: value }, harness.dependencies)).rejects.toThrow();
    expect(harness.events).toEqual([]);
  });

  it("closes the database and does not output when granting fails", async () => {
    const failure = new Error("private database details");
    const harness = createHarness(failure);

    await expect(runGrantServiceRole(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual(["database", "grant", "end"]);
    expect(harness.output).toEqual([]);
  });

  it("rejects an ineligible account without exposing database details", async () => {
    const harness = createHarness(undefined, false);

    await expect(runGrantServiceRole(environment, harness.dependencies))
      .rejects.toThrow("Account is not eligible for a service role grant");
    expect(harness.events).toEqual(["database", "grant", "end"]);
    expect(harness.output).toEqual([]);
  });

  it("exposes the service role grant command through the API package script", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["grant:service-role"]).toBe("tsx src/grant-service-role.ts");
  });
});

function createHarness(failure?: Error, roleGranted = true) {
  const state = { events: [] as string[], output: [] as string[] };
  const dependencies: GrantServiceRoleDependencies = {
    createDatabase() {
      state.events.push("database");
      return { async end() { state.events.push("end"); } } as never;
    },
    createRepository() {
      return {
        async grantServiceOperatorRole(accountId, role) {
          state.events.push("grant");
          if (failure) throw failure;
          expect({ accountId, role }).toEqual({
            accountId: "account_editor", role: "provider_customer_metadata_editor"
          });
          return roleGranted;
        }
      };
    },
    writeOutput(value) { state.events.push("output"); state.output.push(value); }
  };
  return Object.assign(state, { dependencies });
}
