import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportRepository, NotFoundError, ValidationError } from "../src/imports/repository.js";

describe("data readiness", () => {
  let database: ReturnType<ReturnType<typeof newDb>["adapters"]["createPg"]>["Pool"];
  let imports: ImportRepository;

  beforeEach(async () => {
    const memory = newDb();
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await database.query(`
      CREATE TABLE fact_values (
        id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL,
        metric_key TEXT NOT NULL, value BIGINT NOT NULL, unit TEXT NOT NULL,
        range_start DATE NOT NULL, range_end DATE NOT NULL, fact_version_id TEXT NOT NULL,
        source_candidate_id TEXT NOT NULL, source_batch_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    imports = new ImportRepository(database);
    await database.query(`INSERT INTO fact_values
      (id, enterprise_id, store_id, metric_key, value, unit, range_start, range_end, fact_version_id, source_candidate_id, source_batch_id)
      VALUES
      ('current-revenue','ent_demo','store_demo','revenue',3826000,'cents','2026-08-01','2026-08-07','v1','c1','b1'),
      ('current-orders','ent_demo','store_demo','orders',120,'count','2026-08-01','2026-08-07','v1','c2','b1'),
      ('prior-revenue','ent_demo','store_demo','revenue',4400000,'cents','2026-07-25','2026-07-31','v0','c0','b0'),
      ('other-store','ent_demo','store_other','revenue',999,'cents','2026-08-01','2026-08-07','v2','c3','b2')
    `);
  });

  it("reports required metrics, confidence, and comparison readiness without identifiers", async () => {
    const result = await imports.getDataReadiness({ enterpriseId: "ent_demo", storeId: "store_demo", rangeStart: "2026-08-01", rangeEnd: "2026-08-07" });
    expect(result).toEqual({
      rangeStart: "2026-08-01", rangeEnd: "2026-08-07",
      requiredMetrics: ["revenue", "orders", "average_spend"],
      presentMetrics: ["orders", "revenue"], missingMetrics: ["average_spend"],
      confidence: "medium", comparisonAvailable: true
    });
    expect(JSON.stringify(result)).not.toContain("current-revenue");
  });

  it("isolates stores and validates ranges", async () => {
    await expect(imports.getDataReadiness({ enterpriseId: "ent_demo", storeId: "store_missing", rangeStart: "2026-08-01", rangeEnd: "2026-08-07" })).resolves.toMatchObject({ confidence: "low", comparisonAvailable: false });
    await expect(imports.getDataReadiness({ enterpriseId: "ent_demo", storeId: "store_demo", rangeStart: "2026-08-08", rangeEnd: "2026-08-01" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns a deterministic revenue-decline diagnostic from confirmed facts", async () => {
    const diagnostic = await imports.getDeterministicDiagnostic({ enterpriseId: "ent_demo", storeId: "store_demo", rangeStart: "2026-08-01", rangeEnd: "2026-08-07" });
    expect(diagnostic).toMatchObject({ kind: "revenue_decline", confidence: "high", verificationMetric: "下一周期营业额与订单数" });
    expect(diagnostic?.fact).toMatchObject({ currentValue: 3826000, priorValue: 4400000, changePercent: -13.05 });
  });
});
