import { readFile } from "node:fs/promises";
import { hash } from "bcryptjs";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";

const template = {
  name: "Noodle shop story", content: { hook: "Morning broth", story: "The owner starts early", value: "Freshly made", productAppearance: "The bowl arrives naturally", cta: "Visit when nearby", shotRhythm: "Quick cuts", captionVoiceRequirements: "Natural voice", prohibitedExpressions: ["best"] },
  constraints: { industryCode: "fast_food", categoryCode: "rice_noodle", persona: "owner", contentType: "store_story", commercialLevel: 1, style: "sincere", priceDiscountEffectRestrictions: ["no_absolute_claim"], riskLevel: "medium" },
  fallbackScope: { allowCategoryFallback: true, allowIndustryFallback: false }
};
const rule = { name: "Absolute claims", ruleType: "absolute_claim", patterns: ["best"], semanticCategories: ["absolute"], severity: "block", platform: "douyin", scope: "all_copy", guidance: "Use a factual alternative" };

describe("operator content logical versions", () => {
  let pool: Database;
  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg(); pool = new Pool();
    for (const file of ["014_content_templates_rules.sql", "015_operator_accounts_sessions.sql", "016_operator_content_versions.sql"]) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      await pool.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    }
    await pool.query("INSERT INTO operator_accounts (account_id, password_hash, role) VALUES ($1,$2,'operator_admin')", ["op-1", await hash("correct horse", 4)]);
  });

  async function appForAdmin() {
    const app = buildServer({ database: pool });
    const login = await app.inject({ method: "POST", url: "/v1/operator-auth/login", payload: { accountId: "op-1", password: "correct horse" } });
    const cookie = login.headers["set-cookie"]!;
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie, host: "localhost", origin: "http://localhost", "x-csrf-token": login.json().csrfToken };
    return { app, headers };
  }

  it("creates, publishes, and versions a template without mutating v1", async () => {
    const { app, headers } = await appForAdmin();
    const created = await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers, payload: template });
    expect(created.statusCode).toBe(201);
    const logicalId = created.json().logicalId;
    const v1 = await app.inject({ method: "POST", url: `/v1/operator-content/templates/${logicalId}/versions/1/publish`, headers });
    expect(v1.json()).toMatchObject({ logicalId, version: 1, status: "published" });
    const v2 = await app.inject({ method: "PUT", url: `/v1/operator-content/templates/${logicalId}/draft`, headers, payload: { ...template, content: { ...template.content, hook: "Changed hook" } } });
    expect(v2.json()).toMatchObject({ logicalId, version: 2, status: "draft" });
    const original = await app.inject({ method: "GET", url: `/v1/operator-content/templates/${logicalId}/versions/1`, headers });
    expect(original.json().content.hook).toBe("Morning broth");
  });

  it("matches only enabled published templates and tracks disable audits", async () => {
    const { app, headers } = await appForAdmin();
    const logicalId = (await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers, payload: template })).json().logicalId;
    expect((await app.inject({ method: "GET", url: "/v1/operator-content/templates/match?industryCode=fast_food&categoryCode=rice_noodle&persona=owner&contentType=store_story&commercialLevel=1&style=sincere", headers })).json()).toEqual([]);
    await app.inject({ method: "POST", url: `/v1/operator-content/templates/${logicalId}/versions/1/publish`, headers });
    expect((await app.inject({ method: "GET", url: "/v1/operator-content/templates/match?industryCode=fast_food&categoryCode=rice_noodle&persona=owner&contentType=store_story&commercialLevel=1&style=sincere", headers })).json()).toHaveLength(1);
    expect((await app.inject({ method: "POST", url: `/v1/operator-content/templates/${logicalId}/versions/1/disable`, headers })).json()).toMatchObject({ status: "disabled" });
    expect((await app.inject({ method: "GET", url: "/v1/operator-content/templates/match?industryCode=fast_food&categoryCode=rice_noodle&persona=owner&contentType=store_story&commercialLevel=1&style=sincere", headers })).json()).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/v1/operator-content/templates/${logicalId}/history`, headers })).json().events.map((x: { eventType: string }) => x.eventType)).toContain("disabled");
  });

  it("selects only the latest published version of each logical item", async () => {
    const { app, headers } = await appForAdmin();
    const logicalId = (await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers, payload: template })).json().logicalId;
    await app.inject({ method: "POST", url: `/v1/operator-content/templates/${logicalId}/versions/1/publish`, headers });
    const second = await app.inject({ method: "PUT", url: `/v1/operator-content/templates/${logicalId}/draft`, headers, payload: { ...template, name: "Second version" } });
    await app.inject({ method: "POST", url: `/v1/operator-content/templates/${logicalId}/versions/${second.json().version}/publish`, headers });
    const matches = (await app.inject({ method: "GET", url: "/v1/operator-content/templates/match?industryCode=fast_food&categoryCode=rice_noodle&persona=owner&contentType=store_story&commercialLevel=1&style=sincere", headers })).json();
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ version: 2, name: "Second version" });
  });

  it("supports equivalent published rule lifecycle and transient preview", async () => {
    const { app, headers } = await appForAdmin();
    const logicalId = (await app.inject({ method: "POST", url: "/v1/operator-content/rules", headers, payload: rule })).json().logicalId;
    await app.inject({ method: "POST", url: `/v1/operator-content/rules/${logicalId}/versions/1/publish`, headers });
    expect((await app.inject({ method: "GET", url: "/v1/operator-content/rules/active", headers })).json()).toHaveLength(1);
    const preview = await app.inject({ method: "POST", url: "/v1/operator-content/rules/preview", headers, payload: { rule, text: "Our best bowl" } });
    expect(preview.json()).toMatchObject({ matches: [{ pattern: "best", guidance: "Use a factual alternative" }] });
  });

  it("does not disclose content to sessions, trusted callers, or malformed requests outside the admin boundary", async () => {
    const app = buildServer({ database: pool, trustedContextResolver: async () => ({ enterpriseId: "platform", storeId: "operator", actorId: "legacy", actorRole: "operator_editor" }) });
    expect((await app.inject({ method: "GET", url: "/v1/operator-content/templates" })).statusCode).toBe(403);
    const { headers } = await appForAdmin();
    const malformed = await app.inject({ method: "POST", url: "/v1/operator-content/templates", headers, payload: [] });
    expect(malformed.statusCode).toBe(422);
  });
});
