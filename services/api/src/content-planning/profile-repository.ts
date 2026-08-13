import { randomUUID } from "node:crypto";
import type { Database, Queryable } from "../db.js";

export class ProfileValidationError extends Error {}
export class ProfileNotFoundError extends Error {}
export class ProfileConflictError extends Error {}

export interface ProfileScope { enterpriseId: string; storeId: string; actorId: string; }
export interface ContentProfileInput {
  storeName: string; industryCode: string; categoryCode: string; categoryCustomName?: string | null;
  provinceCode: string; cityCode: string; districtCode: string; detailedAddress: string;
  businessDistrictType: string; businessDistrictNote?: string | null; operatingMode: string;
}
export interface ContentProfile extends ContentProfileInput {
  id: string; enterpriseId: string; storeId: string; version: number; createdByActorId: string; createdAt: Date;
  completeness: { required: boolean; missing: string[] };
}
export interface OperatingStageInput { effectiveDate: string; primaryGoal: string; secondaryGoal?: string | null; note?: string | null; }
export interface OperatingStage extends OperatingStageInput { id: string; enterpriseId: string; storeId: string; createdByActorId: string; createdAt: Date; }
type Row = Record<string, unknown>;

export const CONTENT_PROFILE_CODES = {
  industries: ["fast_food", "full_service", "hotpot_skewers", "barbecue_night", "beverages_desserts", "bakery", "snacks_local", "other"],
  categories: ["rice_noodle", "chinese_dining", "sichuan", "hotpot", "skewers", "barbecue", "night_market", "tea_coffee", "dessert", "bakery", "snacks", "local_specialty", "other"],
  businessDistricts: ["office", "community", "mall", "school", "scenic", "transport", "industrial_park", "mixed", "food_street", "other"],
  operatingModes: ["dine_in", "takeaway", "dine_in_takeaway", "group_buy", "multi_mode"],
  goals: ["acquire_customers", "increase_visits", "promote_product", "promote_set", "raise_ticket", "increase_repeat", "increase_takeaway", "increase_group_buy", "brand_awareness", "undecided"]
} as const;

export class ProfileRepository {
  constructor(private readonly database: Queryable) {}

  async getCurrentProfile(scope: ProfileScope): Promise<ContentProfile> {
    const result = await this.database.query<Row>(`SELECT * FROM store_content_profile_versions WHERE enterprise_id = $1 AND store_id = $2 ORDER BY version DESC LIMIT 1`, [scope.enterpriseId, scope.storeId]);
    if (result.rowCount !== 1) throw new ProfileNotFoundError("Content profile not found");
    return toProfile(result.rows[0]);
  }

  async saveProfile(scope: ProfileScope, input: ContentProfileInput): Promise<ContentProfile> {
    validateProfile(input);
    const database = this.database as Database;
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO store_content_profile_version_locks (enterprise_id, store_id) VALUES ($1, $2) ON CONFLICT (enterprise_id, store_id) DO NOTHING", [scope.enterpriseId, scope.storeId]);
      await client.query("SELECT enterprise_id FROM store_content_profile_version_locks WHERE enterprise_id = $1 AND store_id = $2 FOR UPDATE", [scope.enterpriseId, scope.storeId]);
      const latest = await client.query<Row>(`SELECT COALESCE(MAX(version), 0) AS version FROM store_content_profile_versions WHERE enterprise_id = $1 AND store_id = $2`, [scope.enterpriseId, scope.storeId]);
      const version = Number(latest.rows[0].version) + 1;
      const result = await client.query<Row>(`INSERT INTO store_content_profile_versions (id, enterprise_id, store_id, version, store_name, industry_code, category_code, category_custom_name, province_code, city_code, district_code, detailed_address, business_district_type, business_district_note, operating_mode, created_by_actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [randomUUID(), scope.enterpriseId, scope.storeId, version, input.storeName.trim(), input.industryCode.trim(), input.categoryCode.trim(), nullableTrim(input.categoryCustomName), input.provinceCode.trim(), input.cityCode.trim(), input.districtCode.trim(), input.detailedAddress.trim(), input.businessDistrictType.trim(), nullableTrim(input.businessDistrictNote), input.operatingMode.trim(), scope.actorId]);
      await client.query("COMMIT");
      return toProfile(result.rows[0]);
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async createStage(scope: ProfileScope, input: OperatingStageInput): Promise<OperatingStage> {
    validateStage(input);
    try {
      const result = await this.database.query<Row>(`INSERT INTO store_operating_stages (id, enterprise_id, store_id, effective_date, primary_goal, secondary_goal, note, created_by_actor_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [randomUUID(), scope.enterpriseId, scope.storeId, input.effectiveDate, input.primaryGoal.trim(), nullableTrim(input.secondaryGoal), nullableTrim(input.note), scope.actorId]);
      return toStage(result.rows[0]);
    } catch (error) { if (isUniqueViolation(error)) throw new ProfileConflictError("An operating stage already exists for this date"); throw error; }
  }

  async listStages(scope: ProfileScope): Promise<OperatingStage[]> {
    const result = await this.database.query<Row>(`SELECT * FROM store_operating_stages WHERE enterprise_id = $1 AND store_id = $2 ORDER BY effective_date DESC`, [scope.enterpriseId, scope.storeId]);
    return result.rows.map(toStage);
  }
}

function validateProfile(input: ContentProfileInput): void {
  const fields: [keyof ContentProfileInput, string][] = [["storeName", "storeName"],["industryCode", "industryCode"],["categoryCode", "categoryCode"],["provinceCode", "provinceCode"],["cityCode", "cityCode"],["districtCode", "districtCode"],["detailedAddress", "detailedAddress"],["businessDistrictType", "businessDistrictType"],["operatingMode", "operatingMode"]];
  for (const [field, name] of fields) if (typeof input[field] !== "string" || !(input[field] as string).trim()) throw new ProfileValidationError(`${name} is required`);
  assertCode(input.industryCode, CONTENT_PROFILE_CODES.industries, "industryCode");
  assertCode(input.categoryCode, CONTENT_PROFILE_CODES.categories, "categoryCode");
  assertCode(input.businessDistrictType, CONTENT_PROFILE_CODES.businessDistricts, "businessDistrictType");
  assertCode(input.operatingMode, CONTENT_PROFILE_CODES.operatingModes, "operatingMode");
}
function validateStage(input: OperatingStageInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate)) throw new ProfileValidationError("effectiveDate is required");
  const [year, month, day] = input.effectiveDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new ProfileValidationError("effectiveDate must be a real calendar date");
  if (!input.primaryGoal?.trim()) throw new ProfileValidationError("primaryGoal is required");
  assertCode(input.primaryGoal, CONTENT_PROFILE_CODES.goals, "primaryGoal");
  if (input.secondaryGoal) assertCode(input.secondaryGoal, CONTENT_PROFILE_CODES.goals, "secondaryGoal");
  if (input.secondaryGoal?.trim() === input.primaryGoal.trim()) throw new ProfileValidationError("secondaryGoal must differ from primaryGoal");
}
function assertCode(value: string, allowed: readonly string[], name: string): void { if (!allowed.includes(value as never)) throw new ProfileValidationError(`${name} is invalid`); }
function nullableTrim(value: string | null | undefined): string | null { return value?.trim() || null; }
function toProfile(row: Row): ContentProfile { const fields = ["store_name","industry_code","category_code","province_code","city_code","district_code","detailed_address","business_district_type","operating_mode"]; const missing = fields.filter((field) => !String(row[field] ?? "").trim()); return { id: String(row.id), enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), version: Number(row.version), storeName: String(row.store_name), industryCode: String(row.industry_code), categoryCode: String(row.category_code), categoryCustomName: nullable(row.category_custom_name), provinceCode: String(row.province_code), cityCode: String(row.city_code), districtCode: String(row.district_code), detailedAddress: String(row.detailed_address), businessDistrictType: String(row.business_district_type), businessDistrictNote: nullable(row.business_district_note), operatingMode: String(row.operating_mode), createdByActorId: String(row.created_by_actor_id), createdAt: new Date(String(row.created_at)), completeness: { required: missing.length === 0, missing } }; }
function toStage(row: Row): OperatingStage { return { id: String(row.id), enterpriseId: String(row.enterprise_id), storeId: String(row.store_id), effectiveDate: String(row.effective_date), primaryGoal: String(row.primary_goal), secondaryGoal: nullable(row.secondary_goal), note: nullable(row.note), createdByActorId: String(row.created_by_actor_id), createdAt: new Date(String(row.created_at)) }; }
function nullable(value: unknown): string | null { return value == null ? null : String(value); }
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"; }
