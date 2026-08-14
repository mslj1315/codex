import { readFile } from "node:fs/promises";
import { hash } from "bcryptjs";
import type { InjectOptions, Response } from "light-my-request";
import { newDb } from "pg-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { Database } from "../src/db.js";
import type { TrustedContext } from "../src/imports/service.js";

const editor = { enterpriseId: "platform", storeId: "operator", actorId: "editor-1", actorRole: "operator_editor" as const };
const reviewer = { ...editor, actorId: "reviewer-1", actorRole: "operator_reviewer" as const };
const provider = { ...editor, actorId: "provider-1", actorRole: "provider" as const };

describe("operator content templates and review rules", () => {
  let pool: Database;
  beforeEach(async () => {
    const memory = newDb({ noAstCoverageCheck: true });
    const { Pool } = memory.adapters.createPg();
    pool = new Pool();
    const migration = await readFile(new URL("../migrations/014_content_templates_rules.sql", import.meta.url), "utf8");
    await pool.query(migration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    const authMigration = await readFile(new URL("../migrations/015_operator_accounts_sessions.sql", import.meta.url), "utf8");
    await pool.query(authMigration.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
    await pool.query("INSERT INTO operator_accounts (account_id, password_hash, role) VALUES ($1,$2,'operator_admin')", ["op-1", await hash("correct horse", 4)]);
  });

  function appFor(context: TrustedContext) {
    const app = buildServer({ database: pool, trustedContextResolver: async () => context });
    const rawInject = app.inject.bind(app);
    let sessionHeaders: Record<string, string> | undefined;
    return {
      inject: async (options: InjectOptions): Promise<Response> => {
        if (!["POST", "PUT", "PATCH", "DELETE"].includes(String(options.method).toUpperCase())) return rawInject(options);
        if (!sessionHeaders) {
          const login = await rawInject({ method: "POST", url: "/v1/operator-auth/login", payload: { accountId: "op-1", password: "correct horse" } });
          const setCookie = login.headers["set-cookie"];
          sessionHeaders = { cookie: Array.isArray(setCookie) ? setCookie[0] : setCookie!, host: "localhost", origin: "http://localhost", "x-csrf-token": login.json().csrfToken };
        }
        return rawInject({ ...options, headers: { ...sessionHeaders, ...options.headers } });
      }
    };
  }
  const template = {
    name: "面馆老板日常", content: { hook: "今天后厨有点忙", story: "一碗面的坚持", value: "现熬骨汤", productAppearance: "自然带出招牌面", cta: "路过来坐坐", shotRhythm: "快节奏", captionVoiceRequirements: "口播自然" },
    constraints: { industryCode: "fast_food", categoryCode: "rice_noodle", persona: "owner", contentType: "store_story", commercialLevel: 1, style: "sincere", priceDiscountEffectRestrictions: ["no_absolute_claim"] },
    fallbackScope: { allowCategoryFallback: true, allowIndustryFallback: false }
  };

  it("lets an editor draft, edit and submit a structured template", async () => {
    const app = appFor(editor);
    const created = await app.inject({ method: "POST", url: "/v1/operator-content/templates", payload: template });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    const edited = await app.inject({ method: "PUT", url: `/v1/operator-content/templates/${id}`, payload: { ...template, name: "更新名称" } });
    expect(edited.statusCode).toBe(200);
    const submitted = await app.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/submit` });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json()).toMatchObject({ status: "submitted", version: 1, name: "更新名称" });
  });

  it("separates reviewer publication from editor work and keeps published versions immutable", async () => {
    const editorApp = appFor(editor);
    const created = await editorApp.inject({ method: "POST", url: "/v1/operator-content/templates", payload: template });
    const id = created.json().id;
    await editorApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/submit` });
    expect((await editorApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/publish` })).statusCode).toBe(403);
    const reviewerApp = appFor(reviewer);
    expect((await reviewerApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/publish` })).statusCode).toBe(200);
    expect((await editorApp.inject({ method: "PUT", url: `/v1/operator-content/templates/${id}`, payload: template })).statusCode).toBe(409);
  });

  it("allows reviewers to return submitted records and disable published records", async () => {
    const editorApp = appFor(editor); const reviewerApp = appFor(reviewer);
    const id = (await editorApp.inject({ method: "POST", url: "/v1/operator-content/templates", payload: template })).json().id;
    await editorApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/submit` });
    expect((await reviewerApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/return`, payload: { reason: "补充限制" } })).json()).toMatchObject({ status: "returned" });
    await editorApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/submit` });
    await reviewerApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/publish` });
    expect((await reviewerApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/disable` })).json()).toMatchObject({ status: "disabled" });
  });

  it("returns a neutral forbidden response to providers", async () => {
    const response = await appFor(provider).inject({ method: "GET", url: "/v1/operator-content/templates" });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "Forbidden" });
  });

  it("matches only published templates and published rules", async () => {
    const editorApp = appFor(editor); const reviewerApp = appFor(reviewer);
    const id = (await editorApp.inject({ method: "POST", url: "/v1/operator-content/templates", payload: template })).json().id;
    expect((await reviewerApp.inject({ method: "GET", url: "/v1/operator-content/templates/match?industryCode=fast_food&categoryCode=rice_noodle&persona=owner&contentType=store_story&commercialLevel=1&style=sincere" })).json()).toEqual([]);
    await editorApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/submit` });
    await reviewerApp.inject({ method: "POST", url: `/v1/operator-content/templates/${id}/publish` });
    expect((await reviewerApp.inject({ method: "GET", url: "/v1/operator-content/templates/match?industryCode=fast_food&categoryCode=rice_noodle&persona=owner&contentType=store_story&commercialLevel=1&style=sincere" })).json()).toHaveLength(1);
    const rule = await editorApp.inject({ method: "POST", url: "/v1/operator-content/rules", payload: { name: "绝对词", ruleType: "absolute_claim", severity: "block", patterns: ["最好的"] } });
    const ruleId = rule.json().id;
    expect((await reviewerApp.inject({ method: "GET", url: "/v1/operator-content/rules/active" })).json()).toEqual([]);
    await editorApp.inject({ method: "POST", url: `/v1/operator-content/rules/${ruleId}/submit` });
    await reviewerApp.inject({ method: "POST", url: `/v1/operator-content/rules/${ruleId}/publish` });
    expect((await reviewerApp.inject({ method: "GET", url: "/v1/operator-content/rules/active" })).json()).toHaveLength(1);
  });
});
