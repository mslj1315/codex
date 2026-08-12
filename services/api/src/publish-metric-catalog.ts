import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase, type Database } from "./db.js";
import { MetricCatalogOperatorService } from "./metrics/operator-service.js";
import {
  MetricCatalogRepository,
  type MetricDefinition
} from "./metrics/repository.js";

export interface MetricCatalogPublishDatabase extends Database {
  end(): Promise<void>;
}

export interface MetricCatalogPublishOperator {
  createDraftFromPublished(): Promise<{ id: string; versionNumber: number }>;
  upsertDraftDefinition(catalogId: string, definition: MetricDefinition): Promise<void>;
  publishDraft(catalogId: string): Promise<void>;
}

export interface MetricCatalogPublishDependencies {
  readManifest(path: string): Promise<MetricDefinition[]>;
  createDatabase(databaseUrl: string): MetricCatalogPublishDatabase;
  createOperator(database: MetricCatalogPublishDatabase): MetricCatalogPublishOperator;
  writeOutput(value: string): void;
}

const defaultDependencies: MetricCatalogPublishDependencies = {
  async readManifest(path) {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isMetricDefinition)) {
      throw new Error("Metric catalog manifest is invalid");
    }
    return parsed;
  },
  createDatabase,
  createOperator(database) {
    return new MetricCatalogOperatorService(new MetricCatalogRepository(database));
  },
  writeOutput(value) { console.log(value); }
};

export interface MetricCatalogPublishResult {
  versionNumber: number;
  state: "published";
}

export async function runPublishMetricCatalog(
  environment: Record<string, string | undefined> = process.env,
  dependencies: MetricCatalogPublishDependencies = defaultDependencies
): Promise<MetricCatalogPublishResult> {
  const databaseUrl = required(environment.DATABASE_URL, "DATABASE_URL is required");
  const manifestPath = required(environment.METRIC_CATALOG_FILE, "METRIC_CATALOG_FILE is required");
  const manifest = await dependencies.readManifest(manifestPath);
  if (manifest.length === 0) throw new Error("Metric catalog manifest is invalid");

  const database = dependencies.createDatabase(databaseUrl);
  try {
    const operator = dependencies.createOperator(database);
    const draft = await operator.createDraftFromPublished();
    for (const definition of manifest) {
      await operator.upsertDraftDefinition(draft.id, definition);
    }
    await operator.publishDraft(draft.id);
    const result: MetricCatalogPublishResult = { versionNumber: draft.versionNumber, state: "published" };
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally {
    await database.end();
  }
}

function required(value: string | undefined, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(message);
  return value;
}

function isMetricDefinition(value: unknown): value is MetricDefinition {
  if (typeof value !== "object" || value === null) return false;
  const definition = value as Record<string, unknown>;
  return typeof definition.metricKey === "string" && typeof definition.displayName === "string" &&
    (definition.valueKind === "amount" || definition.valueKind === "count" || definition.valueKind === "ratio") &&
    (definition.storageUnit === "cents" || definition.storageUnit === "count" || definition.storageUnit === "basis_points") &&
    typeof definition.allowNegative === "boolean" && typeof definition.requirePositive === "boolean" &&
    typeof definition.usableForReadiness === "boolean" && typeof definition.usableForDiagnostic === "boolean" &&
    typeof definition.usableForVerification === "boolean" && typeof definition.enabled === "boolean";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runPublishMetricCatalog(); }
  catch { console.error("Metric catalog publish failed"); process.exitCode = 1; }
}
