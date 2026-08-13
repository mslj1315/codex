import type { Database } from "../db.js";

export interface ProviderCustomerScope {
  enterpriseId: string;
  storeId: string;
}

export interface ProviderCustomerMetadata {
  customerAlias: string | null;
  providerNote: string | null;
  version: number;
  updatedAt: Date;
}

export type ReplaceMetadataResult =
  | { status: "saved"; metadata: ProviderCustomerMetadata }
  | { status: "cleared" }
  | { status: "conflict" };

interface ReplaceMetadataInput extends ProviderCustomerScope {
  customerAlias: string | null;
  providerNote: string | null;
  expectedVersion: number | null;
  accountId: string;
  now: Date;
}

type MetadataRow = {
  enterprise_id: string;
  store_id: string;
  customer_alias: string | null;
  provider_note: string | null;
  version: number;
  updated_at: Date | string;
};

export function providerCustomerScopeKey(scope: ProviderCustomerScope): string {
  return JSON.stringify([scope.enterpriseId, scope.storeId]);
}

export class ProviderCustomerMetadataRepository {
  constructor(private readonly database: Database) {}

  async listForScopes(scopes: readonly ProviderCustomerScope[]): Promise<Map<string, ProviderCustomerMetadata>> {
    if (scopes.length === 0) return new Map();

    const values = scopes.flatMap((scope) => [scope.enterpriseId, scope.storeId]);
    const placeholders = scopes.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(", ");
    const result = await this.database.query<MetadataRow>(`SELECT enterprise_id, store_id, customer_alias, provider_note, version, updated_at
      FROM provider_customer_metadata
      WHERE (enterprise_id, store_id) IN (VALUES ${placeholders})`, values);
    return new Map(result.rows.map((row) => [
      providerCustomerScopeKey({ enterpriseId: row.enterprise_id, storeId: row.store_id }),
      toMetadata(row)
    ]));
  }

  async scopeExists(scope: ProviderCustomerScope): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(`SELECT EXISTS (
      SELECT 1 FROM (
        SELECT enterprise_id, store_id FROM import_batches
        UNION SELECT enterprise_id, store_id FROM fact_versions
        UNION SELECT enterprise_id, store_id FROM diagnostic_runs
        UNION SELECT enterprise_id, store_id FROM action_cards
      ) AS feedback_scopes
      WHERE enterprise_id = $1 AND store_id = $2
    ) AS exists`, [scope.enterpriseId, scope.storeId]);
    return result.rows[0]?.exists === true;
  }

  async replace(input: ReplaceMetadataInput): Promise<ReplaceMetadataResult> {
    const hasContent = input.customerAlias !== null || input.providerNote !== null;
    if (!hasContent && input.expectedVersion === null) return { status: "cleared" };

    if (hasContent && input.expectedVersion === null) {
      const result = await this.database.query<MetadataRow>(`INSERT INTO provider_customer_metadata
        (enterprise_id, store_id, customer_alias, provider_note, updated_by_account_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT (enterprise_id, store_id) DO NOTHING
        RETURNING customer_alias, provider_note, version, updated_at`, [
        input.enterpriseId, input.storeId, input.customerAlias, input.providerNote, input.accountId, input.now
      ]);
      return result.rows.length === 0 ? { status: "conflict" } : { status: "saved", metadata: toMetadata(result.rows[0]) };
    }

    if (hasContent) {
      const result = await this.database.query<MetadataRow>(`UPDATE provider_customer_metadata
        SET customer_alias = $3, provider_note = $4, updated_by_account_id = $5, updated_at = $7, version = version + 1
        WHERE enterprise_id = $1 AND store_id = $2 AND version = $6
        RETURNING customer_alias, provider_note, version, updated_at`, [
        input.enterpriseId, input.storeId, input.customerAlias, input.providerNote, input.accountId, input.expectedVersion, input.now
      ]);
      return result.rows.length === 0 ? { status: "conflict" } : { status: "saved", metadata: toMetadata(result.rows[0]) };
    }

    const result = await this.database.query(`DELETE FROM provider_customer_metadata
      WHERE enterprise_id = $1 AND store_id = $2 AND version = $3
      RETURNING version`, [input.enterpriseId, input.storeId, input.expectedVersion]);
    return result.rows.length === 0 ? { status: "conflict" } : { status: "cleared" };
  }
}

function toMetadata(row: MetadataRow): ProviderCustomerMetadata {
  return {
    customerAlias: row.customer_alias,
    providerNote: row.provider_note,
    version: Number(row.version),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at)
  };
}
