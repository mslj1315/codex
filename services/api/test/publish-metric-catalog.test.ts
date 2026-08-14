import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { MetricDefinition } from "../src/metrics/repository.js";
import {
  runPublishMetricCatalog,
  type MetricCatalogPublishDependencies
} from "../src/publish-metric-catalog.js";

const environment = {
  DATABASE_URL: "postgresql://operator:private-password@postgres:5432/imports",
  METRIC_CATALOG_FILE: "C:/private/catalog.json"
};

describe("metric catalog publish CLI", () => {
  it("publishes a validated manifest through a draft and writes one public result", async () => {
    const harness = createHarness([definition()]);

    await expect(runPublishMetricCatalog(environment, harness.dependencies)).resolves.toEqual({
      versionNumber: 2,
      state: "published"
    });
    expect(harness.events).toEqual(["read", "database", "draft", "upsert", "publish", "output", "end"]);
    expect(harness.output).toEqual([JSON.stringify({ versionNumber: 2, state: "published" })]);
  });

  it("rejects missing configuration before reading files or opening the database", async () => {
    const harness = createHarness([definition()]);

    await expect(runPublishMetricCatalog({ ...environment, DATABASE_URL: " " }, harness.dependencies))
      .rejects.toThrow("DATABASE_URL is required");
    await expect(runPublishMetricCatalog({ ...environment, METRIC_CATALOG_FILE: " " }, harness.dependencies))
      .rejects.toThrow("METRIC_CATALOG_FILE is required");
    expect(harness.events).toEqual([]);
  });

  it("rejects an unreadable or malformed manifest before opening the database", async () => {
    const failure = new Error("private file contents");
    const harness = createHarness(failure);

    await expect(runPublishMetricCatalog(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual(["read"]);
  });

  it("closes the database and does not print when an operator validation fails", async () => {
    const failure = new Error("private definition details");
    const harness = createHarness([definition()], failure);

    await expect(runPublishMetricCatalog(environment, harness.dependencies)).rejects.toBe(failure);
    expect(harness.events).toEqual(["read", "database", "draft", "upsert", "end"]);
    expect(harness.output).toEqual([]);
  });

  it("exposes the publish command through the API package script", async () => {
    const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["publish:metric-catalog"]).toBe("tsx src/publish-metric-catalog.ts");
  });
});

function definition(): MetricDefinition {
  return {
    metricKey: "lunch_orders",
    displayName: "午市订单数",
    valueKind: "count",
    storageUnit: "count",
    allowNegative: false,
    requirePositive: true,
    usableForReadiness: false,
    usableForDiagnostic: false,
    usableForVerification: true,
    enabled: true
  };
}

function createHarness(manifest: MetricDefinition[] | Error, operatorFailure?: Error) {
  const state = { events: [] as string[], output: [] as string[] };
  const database = { async end() { state.events.push("end"); } } as never;
  const dependencies: MetricCatalogPublishDependencies = {
    async readManifest() {
      state.events.push("read");
      if (manifest instanceof Error) throw manifest;
      return manifest;
    },
    createDatabase() {
      state.events.push("database");
      return database;
    },
    createOperator() {
      return {
        async createDraftFromPublished() {
          state.events.push("draft");
          return { id: "draft_2", versionNumber: 2 };
        },
        async upsertDraftDefinition() {
          state.events.push("upsert");
          if (operatorFailure) throw operatorFailure;
        },
        async publishDraft() { state.events.push("publish"); }
      };
    },
    writeOutput(value: string) {
      state.events.push("output");
      state.output.push(value);
    }
  };
  return Object.assign(state, { dependencies });
}
