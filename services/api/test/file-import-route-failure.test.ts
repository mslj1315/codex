import { describe, expect, it } from "vitest";
import type { Database } from "../src/db.js";
import { buildServer } from "../src/server.js";
import type { StoredObjectInput } from "../src/storage/object-storage.js";

describe("file import route failure recovery", () => {
  it("returns 201 and keeps the object when COMMIT succeeded but its response was lost", async () => {
    const objects = new Map<string, StoredObjectInput>();
    const app = buildServer({
      database: lostCommitDatabase(),
      trustedContextResolver: async () => ({
        enterpriseId: "ent_demo",
        storeId: "store_demo",
        actorId: "actor_demo"
      }),
      objectStorage: {
        async putObject(input) { objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) }); },
        async deleteObject(key) { return objects.delete(key) ? "deleted" : "missing"; }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: Buffer.from("订单数\n12\n")
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ duplicate: false, candidates: [{ metricKey: "orders", value: 12 }] });
    expect(objects.size).toBe(1);
    await app.close();
  });

  it("returns 500 instead of a duplicate 409 when winner reload fails", async () => {
    const reloadFailure = Object.assign(new Error("winner reload private marker"), { code: "ETIMEDOUT" });
    const objects = new Map<string, StoredObjectInput>();
    const deletedKeys: string[] = [];
    const app = buildServer({
      database: duplicateRaceDatabase(reloadFailure),
      trustedContextResolver: async () => ({
        enterpriseId: "ent_demo",
        storeId: "store_demo",
        actorId: "actor_demo"
      }),
      objectStorage: {
        async putObject(input) { objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) }); },
        async deleteObject(key) {
          deletedKeys.push(key);
          return objects.delete(key) ? "deleted" : "missing";
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
      headers: { "content-type": "text/csv", "x-file-name": "weekly.csv" },
      payload: Buffer.from("订单数\n12\n")
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: "Internal server error" });
    expect(response.body).not.toContain("duplicate");
    expect(response.body).not.toContain("private marker");
    expect(objects.size).toBe(0);
    expect(deletedKeys).toHaveLength(1);
    await app.close();
  });
});

function duplicateRaceDatabase(reloadFailure: Error): Database {
  let checksumLookups = 0;
  return {
    async query(text: string) {
      if (!text.includes("SELECT batch_id FROM import_files")) throw new Error(`Unexpected query: ${text}`);
      checksumLookups += 1;
      if (checksumLookups === 1) return result([]);
      throw reloadFailure;
    },
    async connect() {
      return {
        async query(text: string, values: readonly unknown[] = []) {
          if (text === "BEGIN" || text === "ROLLBACK") return result([]);
          if (text.includes("import_batch_reconciliation_guards")) return result([]);
          if (text.includes("INSERT INTO import_batches")) {
            return result([{
              id: values[0], enterprise_id: values[1], store_id: values[2], actor_id: values[3],
              source_type: values[4], status: "pending_confirmation", range_start: values[10],
              range_end: values[11], confirmed_by_actor_id: null, confirmed_at: null,
              created_at: new Date(), updated_at: new Date()
            }]);
          }
          if (text.includes("INSERT INTO import_files")) {
            throw Object.assign(new Error("duplicate file marker"), { code: "23505" });
          }
          throw new Error(`Unexpected transaction query: ${text}`);
        },
        release() {}
      } as never;
    }
  } as Database;
}

function lostCommitDatabase(): Database {
  let batch: Record<string, unknown> | undefined;
  let candidate: Record<string, unknown> | undefined;
  return {
    async query(text: string) {
      if (text.includes("SELECT batch_id FROM import_files")) return result([]);
      if (text.includes("SELECT * FROM import_batches")) return result(batch ? [batch] : []);
      if (text.includes("SELECT * FROM import_candidates")) return result(candidate ? [candidate] : []);
      throw new Error(`Unexpected reconciliation query: ${text}`);
    },
    async connect() {
      return {
        async query(text: string, values: readonly unknown[] = []) {
          if (text === "BEGIN" || text === "ROLLBACK") return result([]);
          if (text.includes("import_batch_reconciliation_guards")) return result([]);
          if (text === "COMMIT") throw Object.assign(new Error("commit response lost"), { code: "ETIMEDOUT" });
          if (text.includes("INSERT INTO import_batches")) {
            batch = {
              id: values[0], enterprise_id: values[1], store_id: values[2], actor_id: values[3],
              source_type: values[4], status: "pending_confirmation", range_start: values[10],
              range_end: values[11], confirmed_by_actor_id: null, confirmed_at: null,
              created_at: new Date(), updated_at: new Date()
            };
            return result([batch]);
          }
          if (text.includes("INSERT INTO import_files")) {
            return result([{
              id: values[0], batch_id: values[1], enterprise_id: values[2], store_id: values[3],
              original_file_name: values[4], normalized_mime_type: values[5], byte_count: values[6],
              sha256_checksum: values[7], object_key: values[8], uploaded_at: values[9],
              expires_at: values[10], cleaned_at: null
            }]);
          }
          if (text.includes("SELECT enterprise_id, store_id FROM import_batches")) {
            return result([{ enterprise_id: batch?.enterprise_id, store_id: batch?.store_id }]);
          }
          if (text.includes("INSERT INTO import_candidates")) {
            candidate = {
              id: values[0], batch_id: values[1], enterprise_id: values[2], store_id: values[3],
              metric_key: values[4], metric_display_name: values[5], value: values[6], unit: values[7],
              range_start: values[8], range_end: values[9], source_locator: values[10], confidence: values[11],
              issue_code: values[12], status: values[13], confirmed_value: null,
              created_at: new Date(), updated_at: new Date()
            };
            return result([candidate]);
          }
          if (text.includes("SELECT * FROM import_batches")) return result(batch ? [batch] : []);
          if (text.includes("SELECT * FROM import_candidates")) return result(candidate ? [candidate] : []);
          throw new Error(`Unexpected transaction query: ${text}`);
        },
        release() {}
      } as never;
    }
  } as Database;
}

function result(rows: Record<string, unknown>[]) {
  return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows };
}
