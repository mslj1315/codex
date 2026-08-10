import { readFile } from "node:fs/promises";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  ImportRepository,
  NotFoundError,
  ValidationError
} from "../src/imports/repository.js";

describe("import repository", () => {
  let imports: ImportRepository;
  let migration: string;

  beforeEach(async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    const pool = new Pool();
    migration = await readFile(
      new URL("../migrations/001_imports.sql", import.meta.url),
      "utf8"
    );

    // pg-mem supports relational constraints but not PostgreSQL PL/pgSQL triggers.
    // Trigger execution and concurrent confirmations require a Docker PostgreSQL test run.
    await pool.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
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

  it("rejects a candidate whose enterprise or store differs from its batch", async () => {
    const batch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });

    await expect(imports.createCandidate({
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_other",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 4826000,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a candidate value outside the JSON safe-integer range", async () => {
    const batch = await imports.createBatch({
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      actorId: "actor_demo",
      sourceType: "manual"
    });

    await expect(imports.createCandidate({
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: Number.MAX_SAFE_INTEGER + 1,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    })).rejects.toBeInstanceOf(ValidationError);

    await expect(imports.createCandidate({
      batchId: batch.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo",
      metricKey: "revenue",
      metricDisplayName: "Revenue",
      value: 1.5,
      unit: "cents",
      rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07",
      sourceLocator: "manual:revenue",
      confidence: 100,
      status: "ready"
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it("declares one fact version per source batch and append-only fact triggers", () => {
    expect(migration).toContain("UNIQUE (source_batch_id)");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION reject_fact_mutation()");
    expect(migration).toContain("RAISE EXCEPTION 'fact records are append-only'");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON fact_versions");
    expect(migration).toContain("BEFORE UPDATE OR DELETE ON fact_values");
  });

  it("returns typed errors for a repeat confirmation and non-ready candidate", async () => {
    const batch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
    const candidate = await imports.createCandidate({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: "revenue",
      metricDisplayName: "Revenue", value: 4826000, unit: "cents", rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07", sourceLocator: "manual:revenue", confidence: 100, status: "needs_confirmation"
    });
    await expect(imports.confirmBatch({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [candidate.id]
    })).rejects.toBeInstanceOf(ValidationError);

    const readyCandidate = await imports.createCandidate({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", metricKey: "orders",
      metricDisplayName: "Orders", value: 120, unit: "orders", rangeStart: "2026-08-01",
      rangeEnd: "2026-08-07", sourceLocator: "manual:orders", confidence: 100, status: "ready"
    });
    const factVersion = await imports.confirmBatch({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [readyCandidate.id]
    });
    await expect(imports.confirmBatch({
      batchId: batch.id, enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", candidateIds: [readyCandidate.id]
    })).rejects.toBeInstanceOf(ConflictError);
    await expect(imports.getFactVersion({ id: factVersion.id, enterpriseId: "ent_demo", storeId: "store_other" }))
      .rejects.toBeInstanceOf(NotFoundError);
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

    const historicalFirst = await imports.getFactVersion({
      id: firstVersion.id,
      enterpriseId: "ent_demo",
      storeId: "store_demo"
    });

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
