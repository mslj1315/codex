import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportRepository } from "../src/imports/repository.js";

describe("import repository", () => {
  let imports: ImportRepository;

  beforeEach(async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    const migration = await readFile(
      new URL("../migrations/001_imports.sql", import.meta.url),
      "utf8"
    );

    await pool.query(migration);
    imports = new ImportRepository(pool);
  });

  it("creates a store-scoped pending batch", async () => {
    const batch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });

    expect(batch.status).toBe("pending_confirmation");
    expect(batch.storeId).toBe("store_demo");
  });

  it("appends fact versions without changing historical candidate provenance", async () => {
    const firstBatch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });
    const firstCandidate = await imports.createCandidate({
      batchId: firstBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 4826000,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    });
    const firstVersion = await imports.confirmBatch({
      batchId: firstBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      candidateIds: [firstCandidate.id]
    });

    const secondBatch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });
    const secondCandidate = await imports.createCandidate({
      batchId: secondBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 5000000,
      unit: "cents",
      rangeStart: "2026-08-08",
      rangeEnd: "2026-08-14",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    });
    const secondVersion = await imports.confirmBatch({
      batchId: secondBatch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      candidateIds: [secondCandidate.id]
    });

    const historicalFirst = await imports.getFactVersion(firstVersion.id);

    expect(secondVersion.id).not.toBe(firstVersion.id);
    expect(historicalFirst.values).toEqual([
      expect.objectContaining({
        value: 4826000,
        sourceCandidateId: firstCandidate.id,
        sourceBatchId: firstBatch.id
      })
    ]);
    expect(secondVersion.values).toEqual([
      expect.objectContaining({
        value: 5000000,
        sourceCandidateId: secondCandidate.id,
        sourceBatchId: secondBatch.id
      })
    ]);
  });
});
