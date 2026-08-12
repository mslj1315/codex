import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../db.js";

export type MetricValueKind = "amount" | "count" | "ratio";
export type MetricStorageUnit = "cents" | "count" | "basis_points";
export type MetricCatalogState = "draft" | "published" | "retired";

export interface MetricDefinition {
  metricKey: string;
  displayName: string;
  valueKind: MetricValueKind;
  storageUnit: MetricStorageUnit;
  allowNegative: boolean;
  requirePositive: boolean;
  usableForReadiness: boolean;
  usableForDiagnostic: boolean;
  usableForVerification: boolean;
  enabled: boolean;
}

export interface MetricCatalog {
  id: string;
  versionNumber: number;
  state: MetricCatalogState;
  definitions: MetricDefinition[];
}

export class MetricCatalogValidationError extends Error {}
export class MetricCatalogNotFoundError extends Error {}

const CORE_READINESS_KEYS = ["revenue", "orders", "average_spend"];

export class MetricCatalogRepository {
  constructor(private readonly database: Queryable, private readonly transactionDatabase?: Database) {}

  async createDraftFromPublished(): Promise<MetricCatalog> {
    return this.transaction(async (client) => {
      const published = await this.readCurrentCatalog(client, "FOR UPDATE");
      const versionNumber = published.versionNumber + 1;
      const id = randomUUID();
      await client.query(
        "INSERT INTO metric_catalog_versions (id, version_number, state) VALUES ($1, $2, 'draft')",
        [id, versionNumber]
      );
      for (const definition of published.definitions) {
        await insertDefinition(client, id, definition);
      }
      return { id, versionNumber, state: "draft", definitions: published.definitions };
    });
  }

  async upsertDraftDefinition(catalogId: string, definition: MetricDefinition): Promise<void> {
    validateDefinition(definition);
    await this.transaction(async (client) => {
      const catalog = await readCatalogRow(client, catalogId, "FOR UPDATE");
      if (catalog.state !== "draft") throw new MetricCatalogValidationError("Only draft catalogs can be edited");
      await client.query(
        `INSERT INTO metric_definitions (
          metric_catalog_version_id, metric_key, display_name, value_kind, storage_unit,
          allow_negative, require_positive, usable_for_readiness, usable_for_diagnostic,
          usable_for_verification, enabled
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (metric_catalog_version_id, metric_key) DO UPDATE SET
          display_name = EXCLUDED.display_name, value_kind = EXCLUDED.value_kind,
          storage_unit = EXCLUDED.storage_unit, allow_negative = EXCLUDED.allow_negative,
          require_positive = EXCLUDED.require_positive, usable_for_readiness = EXCLUDED.usable_for_readiness,
          usable_for_diagnostic = EXCLUDED.usable_for_diagnostic,
          usable_for_verification = EXCLUDED.usable_for_verification, enabled = EXCLUDED.enabled,
          updated_at = CURRENT_TIMESTAMP`,
        definitionValues(catalogId, definition)
      );
    });
  }

  async publishDraft(catalogId: string): Promise<void> {
    await this.transaction(async (client) => {
      const draft = await this.readCatalog(client, catalogId, "FOR UPDATE");
      if (draft.state !== "draft") throw new MetricCatalogValidationError("Only draft catalogs can be published");
      for (const key of CORE_READINESS_KEYS) {
        const definition = draft.definitions.find((item) => item.metricKey === key);
        if (!definition?.enabled || !definition.usableForReadiness) {
          throw new MetricCatalogValidationError(`Core readiness metric ${key} must remain enabled`);
        }
      }
      const published = await this.readCurrentCatalog(client, "FOR UPDATE");
      await client.query("UPDATE metric_catalog_versions SET state = 'retired' WHERE id = $1", [published.id]);
      await client.query("UPDATE metric_catalog_versions SET state = 'published', published_at = CURRENT_TIMESTAMP WHERE id = $1", [catalogId]);
    });
  }

  async getCurrentCatalog(): Promise<MetricCatalog> { return this.readCurrentCatalog(this.database); }
  async getCatalog(id: string): Promise<MetricCatalog> { return this.readCatalog(this.database, id); }
  async resolvePublishedMetricDefinitions(): Promise<{ catalogId: string; definitions: Map<string, MetricDefinition> }> {
    const catalog = await this.readCurrentCatalog(this.database, "FOR SHARE");
    return { catalogId: catalog.id, definitions: new Map(catalog.definitions.map((definition) => [definition.metricKey, definition])) };
  }

  private async readCurrentCatalog(database: Queryable, lock = ""): Promise<MetricCatalog> {
    const result = await database.query("SELECT * FROM metric_catalog_versions WHERE state = 'published' " + lock);
    if (result.rowCount !== 1) throw new MetricCatalogNotFoundError("Published metric catalog not found");
    return this.readCatalog(database, String(result.rows[0].id));
  }

  private async readCatalog(database: Queryable, id: string, lock = ""): Promise<MetricCatalog> {
    const row = await readCatalogRow(database, id, lock);
    const definitions = await database.query("SELECT * FROM metric_definitions WHERE metric_catalog_version_id = $1 ORDER BY metric_key", [id]);
    return { id: String(row.id), versionNumber: Number(row.version_number), state: row.state as MetricCatalogState, definitions: definitions.rows.map(toDefinition) };
  }

  private async transaction<T>(operation: (client: Queryable) => Promise<T>): Promise<T> {
    const database = this.transactionDatabase ?? (isDatabase(this.database) ? this.database : undefined);
    if (!database) return operation(this.database);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

async function readCatalogRow(database: Queryable, id: string, lock = ""): Promise<Record<string, unknown>> {
  const result = await database.query("SELECT * FROM metric_catalog_versions WHERE id = $1 " + lock, [id]);
  if (result.rowCount !== 1) throw new MetricCatalogNotFoundError("Metric catalog not found");
  return result.rows[0];
}

async function insertDefinition(database: Queryable, catalogId: string, definition: MetricDefinition): Promise<void> {
  await database.query(
    `INSERT INTO metric_definitions (metric_catalog_version_id, metric_key, display_name, value_kind, storage_unit, allow_negative, require_positive, usable_for_readiness, usable_for_diagnostic, usable_for_verification, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, definitionValues(catalogId, definition)
  );
}
function definitionValues(catalogId: string, definition: MetricDefinition): unknown[] {
  return [catalogId, definition.metricKey, definition.displayName, definition.valueKind, definition.storageUnit, definition.allowNegative, definition.requirePositive, definition.usableForReadiness, definition.usableForDiagnostic, definition.usableForVerification, definition.enabled];
}
function toDefinition(row: Record<string, unknown>): MetricDefinition {
  return { metricKey: String(row.metric_key), displayName: String(row.display_name), valueKind: row.value_kind as MetricValueKind, storageUnit: row.storage_unit as MetricStorageUnit, allowNegative: Boolean(row.allow_negative), requirePositive: Boolean(row.require_positive), usableForReadiness: Boolean(row.usable_for_readiness), usableForDiagnostic: Boolean(row.usable_for_diagnostic), usableForVerification: Boolean(row.usable_for_verification), enabled: Boolean(row.enabled) };
}
function validateDefinition(definition: MetricDefinition): void {
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(definition.metricKey) || definition.displayName.trim().length === 0 || definition.displayName.length > 120) throw new MetricCatalogValidationError("Metric definition is invalid");
  const expectedUnit: Record<MetricValueKind, MetricStorageUnit> = { amount: "cents", count: "count", ratio: "basis_points" };
  if (definition.storageUnit !== expectedUnit[definition.valueKind] || (definition.requirePositive && definition.allowNegative)) throw new MetricCatalogValidationError("Metric definition domain is invalid");
}
function isDatabase(value: Queryable): value is Database { return "connect" in value && typeof value.connect === "function"; }
