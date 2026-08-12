import { readdir, readFile } from "node:fs/promises";
import { DataType, newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { ProviderFeedbackRepository } from "../src/provider-feedback/repository.js";
import { parseProviderFeedbackQuery, ProviderFeedbackService } from "../src/provider-feedback/service.js";
import type { ProviderFeedbackRow } from "../src/provider-feedback/repository.js";

describe("provider feedback repository", () => {
  let database: Database;
  let feedback: ProviderFeedbackRepository;
  const now = new Date("2026-08-13T00:00:00.000Z");

  beforeEach(async () => {
    const memory = newDb();
    memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
    const { Pool } = memory.adapters.createPg();
    database = new Pool();
    await applyTestMigrations(database);
    feedback = new ProviderFeedbackRepository(database);

  });

  it("returns only aggregate adoption and outcome feedback", async () => {
    await seedConfirmedScope({ enterpriseId: "ent_active", storeId: "store_active", importAt: "2026-08-12T23:00:00.000Z", confirmedAt: "2026-08-12T23:10:00.000Z", metricKeys: ["revenue"] });
    await database.query(`INSERT INTO diagnostic_runs
      (id, enterprise_id, store_id, kind, range_start, range_end, prior_range_start, prior_range_end, rule_version, confidence, snapshot_key)
      VALUES ('diagnostic_active', 'ent_active', 'store_active', 'revenue_decline', '2026-08-01', '2026-08-07', '2026-07-25', '2026-07-31', 'v1', 'high', 'snapshot_active')`);
    await database.query(`INSERT INTO action_cards
      (id, enterprise_id, store_id, created_by_actor_id, diagnostic_kind, range_start, range_end, title, action, verification_metric, status, execution_note, verification_outcome)
      VALUES
      ('action_progress', 'ent_active', 'store_active', 'actor_sentinel', 'revenue_decline', '2026-08-01', '2026-08-07', 'private action title', 'private action', 'private metric', 'in_progress', 'private note', NULL),
      ('action_verified', 'ent_active', 'store_active', 'actor_sentinel', 'revenue_decline', '2026-08-01', '2026-08-07', 'private action title', 'private action', 'private metric', 'verified', 'private note', 'effective')`);

    const page = await feedback.list({ now, limit: 10 });

    expect(page.items).toEqual([
      {
        enterpriseId: "ent_active", storeId: "store_active",
        lastSuccessfulImportAt: new Date("2026-08-12T23:00:00.000Z"),
        lastConfirmedAt: new Date("2026-08-12T23:10:00.000Z"),
        activityState: "active", readinessState: "incomplete", missingMetricCount: 2,
        diagnosticCounts: { revenue_decline: 1 },
        actionCardStatusCounts: { in_progress: 1, verified: 1 },
        verificationOutcomeCounts: { effective: 1 },
        lastCoverageAt: new Date("2026-08-12T23:10:00.000Z")
      }
    ]);
    expect(JSON.stringify(page)).not.toMatch(/987654321|sentinel-file|sentinel-checksum|private action|private note|actor_sentinel/i);
  });

  it("classifies the thirty-day activity boundary and unavailable readiness", async () => {
    await seedImportOnly({ enterpriseId: "ent_boundary", storeId: "store_boundary", importAt: "2026-07-14T00:00:00.000Z" });
    await seedImportOnly({ enterpriseId: "ent_stale", storeId: "store_stale", importAt: "2026-07-13T23:59:59.999Z" });
    await database.query("INSERT INTO action_cards (id, enterprise_id, store_id, created_by_actor_id, diagnostic_kind, range_start, range_end, title, action, verification_metric, status) VALUES ('action_inactive', 'ent_inactive', 'store_inactive', 'actor_sentinel', 'manual', '2026-08-01', '2026-08-07', 'private action title', 'private action', 'private metric', 'proposed')");

    const page = await feedback.list({ now, limit: 10 });
    const states = Object.fromEntries(page.items.map((item) => [`${item.enterpriseId}/${item.storeId}`, item]));

    expect(states["ent_boundary/store_boundary"]).toMatchObject({ activityState: "active", readinessState: "unavailable", missingMetricCount: 3 });
    expect(states["ent_stale/store_stale"]).toMatchObject({ activityState: "stale", readinessState: "unavailable", missingMetricCount: 3 });
    expect(states["ent_inactive/store_inactive"]).toMatchObject({ activityState: "inactive", readinessState: "unavailable", missingMetricCount: 3 });
  });

  it("uses strict filters and opaque cursor pagination without duplicate scopes", async () => {
    const rows: ProviderFeedbackRow[] = [
      feedbackRow("ent_a", "store_a", "2026-08-12T00:00:00.000Z", "active", "ready"),
      feedbackRow("ent_b", "store_b", "2026-08-12T00:00:00.000Z", "active", "incomplete"),
      feedbackRow("ent_c", "store_c", "2026-08-11T00:00:00.000Z", "stale", "unavailable"),
      feedbackRow("ent_d", "store_d", null, "inactive", "unavailable")
    ];
    const service = new ProviderFeedbackService({
      async list(input) {
        const matching = rows.filter((item) => (!input.activityState || item.activityState === input.activityState) && (!input.readinessState || item.readinessState === input.readinessState)).filter((item) => {
          if (!input.after) return true;
          const itemTime = item.lastSuccessfulImportAt?.getTime() ?? null;
          const cursorTime = input.after.lastSuccessfulImportAt?.getTime() ?? null;
          if (cursorTime === null) return itemTime === null && (item.enterpriseId > input.after.enterpriseId || item.enterpriseId === input.after.enterpriseId && item.storeId > input.after.storeId);
          if (itemTime === null) return true;
          if (itemTime !== cursorTime) return itemTime < cursorTime;
          return item.enterpriseId > input.after.enterpriseId || item.enterpriseId === input.after.enterpriseId && item.storeId > input.after.storeId;
        });
        return { items: matching.slice(0, input.limit), hasMore: matching.length > input.limit };
      }
    }, () => now);

    const filtered = await service.list(parseProviderFeedbackQuery({ limit: "2", activityState: "active" }));
    const first = await service.list(parseProviderFeedbackQuery({ limit: "2" }));
    const second = await service.list(parseProviderFeedbackQuery({ limit: "2", cursor: first.nextCursor! }));

    expect(filtered.items.map((item) => item.storeId)).toEqual(["store_a", "store_b"]);
    expect(filtered.nextCursor).toBeNull();
    expect(first.items.map((item) => item.storeId)).toEqual(["store_a", "store_b"]);
    expect(second.items.map((item) => item.storeId)).toEqual(["store_c", "store_d"]);
    expect(second.nextCursor).toBeNull();
    for (const query of [
      { limit: "0" }, { limit: "101" }, { limit: "1.5" }, { limit: ["2"] },
      { activityState: "all" }, { readinessState: "raw" }, { cursor: "not-a-base64url-json-cursor" }
    ]) expect(() => parseProviderFeedbackQuery(query)).toThrow();
  });

  async function seedImportOnly(input: { enterpriseId: string; storeId: string; importAt: string }) {
    await database.query(`INSERT INTO import_batches
      (id, enterprise_id, store_id, actor_id, source_type, original_file_name, original_file_checksum, status, created_at)
      VALUES ($1, $2, $3, 'actor_sentinel', 'csv', 'sentinel-file.csv', 'sentinel-checksum', 'pending_confirmation', $4)`,
    [`batch_${input.storeId}`, input.enterpriseId, input.storeId, input.importAt]);
  }

  async function seedConfirmedScope(input: { enterpriseId: string; storeId: string; importAt: string; confirmedAt: string; metricKeys: string[] }) {
    await seedImportOnly(input);
    const batchId = `batch_${input.storeId}`;
    await database.query("UPDATE import_batches SET status = 'confirmed', confirmed_at = $1 WHERE id = $2", [input.confirmedAt, batchId]);
    await database.query("INSERT INTO fact_versions (id, enterprise_id, store_id, source_batch_id, confirmation_actor_id, confirmation_status, confirmed_at) VALUES ($1, $2, $3, $4, 'actor_sentinel', 'confirmed', $5)", [`version_${input.storeId}`, input.enterpriseId, input.storeId, batchId, input.confirmedAt]);
    for (const metricKey of input.metricKeys) {
      await database.query("INSERT INTO import_candidates (id, batch_id, enterprise_id, store_id, metric_key, metric_display_name, value, unit, range_start, range_end, source_locator, confidence, status) VALUES ($1, $2, $3, $4, $5, 'Private metric', 987654321, 'cents', '2026-08-01', '2026-08-07', 'private-locator', 100, 'confirmed')", [`candidate_${input.storeId}_${metricKey}`, batchId, input.enterpriseId, input.storeId, metricKey]);
      await database.query("INSERT INTO fact_values (id, fact_version_id, enterprise_id, store_id, metric_key, value, unit, range_start, range_end, source_candidate_id, source_batch_id) VALUES ($1, $2, $3, $4, $5, 987654321, 'cents', '2026-08-01', '2026-08-07', $6, $7)", [`fact_${input.storeId}_${metricKey}`, `version_${input.storeId}`, input.enterpriseId, input.storeId, metricKey, `candidate_${input.storeId}_${metricKey}`, batchId]);
    }
  }
});

function feedbackRow(enterpriseId: string, storeId: string, importedAt: string | null, activityState: "active" | "stale" | "inactive", readinessState: "ready" | "incomplete" | "unavailable"): ProviderFeedbackRow {
  return { enterpriseId, storeId, lastSuccessfulImportAt: importedAt === null ? null : new Date(importedAt), lastConfirmedAt: null, activityState, readinessState, missingMetricCount: 0, diagnosticCounts: {}, actionCardStatusCounts: {}, verificationOutcomeCounts: {}, lastCoverageAt: null };
}

async function applyTestMigrations(database: Database): Promise<void> {
  const migrationsUrl = new URL("../migrations/", import.meta.url);
  const files = (await readdir(migrationsUrl)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(new URL(file, migrationsUrl), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
