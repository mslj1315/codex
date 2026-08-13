import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { ImportRepository, ValidationError } from "../src/imports/repository.js";
import { MetricCatalogRepository, MetricCatalogValidationError } from "../src/metrics/repository.js";

describe("metric catalog", () => {
  let catalog: MetricCatalogRepository;
  let database: Database;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    catalog = new MetricCatalogRepository(database);
  });

  it("creates, edits, and publishes a draft copied from the current catalog", async () => {
    const draft = await catalog.createDraftFromPublished();
    await catalog.upsertDraftDefinition(draft.id, definition({ metricKey: "lunch_orders", displayName: "Lunch orders" }));
    await catalog.publishDraft(draft.id);

    const current = await catalog.getCurrentCatalog();
    expect(current.versionNumber).toBe(2);
    expect(current.definitions).toContainEqual(expect.objectContaining({ metricKey: "lunch_orders", enabled: true }));
    expect((await catalog.getCatalog(draft.id)).state).toBe("published");
    expect((await catalog.getCatalog("metric_catalog_v1")).state).toBe("retired");
  });

  it("rejects edits to a published catalog and replaces a draft key deterministically", async () => {
    await expect(catalog.upsertDraftDefinition("metric_catalog_v1", definition())).rejects.toBeInstanceOf(MetricCatalogValidationError);
    const draft = await catalog.createDraftFromPublished();
    await catalog.upsertDraftDefinition(draft.id, definition());
    await catalog.upsertDraftDefinition(draft.id, definition({ displayName: "Changed name" }));
    expect((await catalog.getCatalog(draft.id)).definitions).toContainEqual(expect.objectContaining({ metricKey: "lunch_orders", displayName: "Changed name" }));
  });

  it("rejects invalid metric domains and publishing without enabled readiness core metrics", async () => {
    const draft = await catalog.createDraftFromPublished();
    await expect(catalog.upsertDraftDefinition(draft.id, definition({ valueKind: "count", storageUnit: "cents" }))).rejects.toBeInstanceOf(MetricCatalogValidationError);
    await expect(catalog.upsertDraftDefinition(draft.id, definition({ allowNegative: true, requirePositive: true }))).rejects.toBeInstanceOf(MetricCatalogValidationError);
    await catalog.upsertDraftDefinition(draft.id, definition({ metricKey: "revenue", enabled: false }));
    await expect(catalog.publishDraft(draft.id)).rejects.toBeInstanceOf(MetricCatalogValidationError);
  });

  it("binds confirmations to the published catalog and rejects definitions outside its domain", async () => {
    const imports = new ImportRepository(database);
    const batch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    const valid = await imports.createCandidate(candidate(batch.id, { metricKey: "revenue", unit: "cents", value: 4826000 }));
    const factVersion = await imports.confirmBatch({ batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [valid.id] });
    expect(factVersion.metricCatalogVersionId).toBe("metric_catalog_v1");

    const invalidBatch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    const invalid = await imports.createCandidate(candidate(invalidBatch.id, { metricKey: "orders", unit: "cents", value: 0 }));
    await expect(imports.confirmBatch({ batchId: invalidBatch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [invalid.id] })).rejects.toBeInstanceOf(ValidationError);
    expect((await imports.getBatch({ id: invalidBatch.id, enterpriseId: "ent_demo", storeId: "store_demo" })).status).toBe("pending_confirmation");
  });
});

function definition(overrides: Partial<{
  metricKey: string; displayName: string; valueKind: "amount" | "count" | "ratio";
  storageUnit: "cents" | "count" | "basis_points"; allowNegative: boolean; requirePositive: boolean;
  usableForReadiness: boolean; usableForDiagnostic: boolean; usableForVerification: boolean; enabled: boolean;
}> = {}) {
  return {
    metricKey: "lunch_orders", displayName: "Lunch orders", valueKind: "count" as const, storageUnit: "count" as const,
    allowNegative: false, requirePositive: true, usableForReadiness: false,
    usableForDiagnostic: false, usableForVerification: false, enabled: true, ...overrides
  };
}

function candidate(batchId: string, overrides: { metricKey: string; unit: string; value: number }) {
  return { batchId, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: overrides.metricKey, metricDisplayName: overrides.metricKey, value: overrides.value, unit: overrides.unit, rangeStart: "2026-08-01", rangeEnd: "2026-08-07", sourceLocator: `manual:${overrides.metricKey}`, confidence: 100, status: "ready" as const };
}

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const fileNames = (await readdir(migrationsUrl)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of fileNames) {
    const sql = await readFile(new URL(name, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
