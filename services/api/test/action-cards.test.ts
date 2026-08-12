import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { ImportRepository, ConflictError, ValidationError } from "../src/imports/repository.js";

describe("action cards", () => {
  let database: any;
  let imports: ImportRepository;

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await database.query(`CREATE TABLE action_cards (
      id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL, created_by_actor_id TEXT NOT NULL,
      diagnostic_kind TEXT NOT NULL, range_start DATE NOT NULL, range_end DATE NOT NULL, title TEXT NOT NULL,
      action TEXT NOT NULL, verification_metric TEXT NOT NULL, status TEXT NOT NULL, due_date DATE,
      execution_note TEXT, verification_outcome TEXT, completed_at TIMESTAMPTZ, verified_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    imports = new ImportRepository(database);
  });

  it("creates a proposed store-scoped card and advances only through valid states", async () => {
    const card = await imports.createActionCard({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", diagnosticKind: "revenue_decline", rangeStart: "2026-08-01", rangeEnd: "2026-08-07", title: "检查午市套餐", action: "检查订单量与客单价", verificationMetric: "下一周期营业额与订单数", dueDate: "2026-08-14" });
    expect(card).toMatchObject({ status: "proposed", storeId: "store_demo", title: "检查午市套餐" });
    await expect(imports.updateActionCardStatus({ id: card.id, enterpriseId: "ent_demo", storeId: "store_demo", status: "verified", now: new Date() })).rejects.toBeInstanceOf(ConflictError);
    const started = await imports.updateActionCardStatus({ id: card.id, enterpriseId: "ent_demo", storeId: "store_demo", status: "in_progress", now: new Date() });
    expect(started.status).toBe("in_progress");
  });

  it("isolates cards and validates date/status input", async () => {
    const card = await imports.createActionCard({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", diagnosticKind: "revenue_decline", rangeStart: "2026-08-01", rangeEnd: "2026-08-07", title: "检查", action: "执行", verificationMetric: "营业额" });
    await expect(imports.updateActionCardStatus({ id: card.id, enterpriseId: "ent_demo", storeId: "store_other", status: "in_progress", now: new Date() })).rejects.toBeInstanceOf(ValidationError);
    await expect(imports.createActionCard({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", diagnosticKind: "revenue_decline", rangeStart: "2026-08-08", rangeEnd: "2026-08-01", title: "", action: "执行", verificationMetric: "营业额" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists cards newest first and supports a validated status filter", async () => {
    await imports.createActionCard({ id: "action_001", enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", diagnosticKind: "revenue_decline", rangeStart: "2026-08-01", rangeEnd: "2026-08-07", title: "旧", action: "执行", verificationMetric: "营业额" });
    const newest = await imports.createActionCard({ id: "action_002", enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", diagnosticKind: "revenue_decline", rangeStart: "2026-08-01", rangeEnd: "2026-08-07", title: "新", action: "执行", verificationMetric: "营业额" });
    await imports.updateActionCardStatus({ id: newest.id, enterpriseId: "ent_demo", storeId: "store_demo", status: "in_progress", now: new Date() });
    const cards = await imports.listActionCards({ enterpriseId: "ent_demo", storeId: "store_demo" });
    expect(cards.map((card) => card.title)).toEqual(["新", "旧"]);
    await expect(imports.listActionCards({ enterpriseId: "ent_demo", storeId: "store_demo", status: "invalid" as never })).rejects.toBeInstanceOf(ValidationError);
  });

  it("records bounded execution evidence on completion and a fixed review outcome on verification", async () => {
    const card = await imports.createActionCard({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", diagnosticKind: "revenue_decline", rangeStart: "2026-08-01", rangeEnd: "2026-08-07", title: "检查", action: "执行", verificationMetric: "营业额" });
    await imports.updateActionCardStatus({ id: card.id, enterpriseId: "ent_demo", storeId: "store_demo", status: "in_progress", now: new Date() });
    const completed = await imports.updateActionCardStatus({ id: card.id, enterpriseId: "ent_demo", storeId: "store_demo", status: "completed", now: new Date(), executionNote: "已检查午市套餐展示与核销流程" });
    expect(completed).toMatchObject({ status: "completed", executionNote: "已检查午市套餐展示与核销流程" });
    const verified = await imports.updateActionCardStatus({ id: card.id, enterpriseId: "ent_demo", storeId: "store_demo", status: "verified", now: new Date(), verificationOutcome: "data_insufficient" });
    expect(verified).toMatchObject({ status: "verified", verificationOutcome: "data_insufficient" });
  });
});
