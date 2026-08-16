# OpenAI Responses And Token Pricing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-only OpenAI Responses provider and immutable CNY-per-million-token price versions with privacy-safe usage aggregation.

**Architecture:** `OpenAIResponsesProvider` implements the existing provider interface and sends structured requests with `store:false`. Successful generation runs freeze an effective published price snapshot. The service-provider console manages prices and sees only provider/model/date aggregates; customer and raw-content dimensions never cross that boundary.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, Vitest, React/Vite, Android Compose.

---

### Task 1: OpenAI Responses Provider

**Files:**
- Create: `services/api/src/model-providers/openai-responses.ts`
- Modify: `services/api/src/model-providers/provider.ts`
- Modify: `services/api/src/model-providers/generation.ts`
- Modify: `services/api/test/model-providers.test.ts`
- Modify: `.env.example`

- [ ] Write failing tests that configure `openai_responses` and assert HTTPS `POST {baseUrl}/responses`, bearer authorization, `store:false`, structured JSON output, parsed output text, token usage, malformed output, and HTTP 429 retry.
- [ ] Run `cd services/api; npm test -- --run test/model-providers.test.ts` and confirm RED because `openai_responses` is unsupported.
- [ ] Implement `OpenAIResponsesProvider`; extend provider configuration validation; normalize the HTTPS root; parse only final JSON text and numeric usage.
- [ ] Run the focused tests and `npm run typecheck`; update `.env.example` with server-only comments and no key.
- [ ] Commit: `git commit -m "feat: add OpenAI Responses model provider"`.

### Task 2: Immutable Price And Cost Snapshots

**Files:**
- Create: `services/api/migrations/028_model_token_pricing.sql`
- Modify: `services/api/src/content-planning/workflow-routes.ts`
- Modify: `services/api/test/content-planning-workflow.test.ts`
- Modify: `services/api/test/migrate.test.ts`

- [ ] Write failing tests for published CNY prices per 1,000,000 tokens: input `8`, output `32`, with a `1000`/`2000` token run storing `0.008`, `0.064`, and `0.072` immutable costs; test unpriced runs and later price changes do not alter history.
- [ ] Run `npm test -- --run test/migrate.test.ts test/content-planning-workflow.test.ts` and confirm RED.
- [ ] Add append-only price versions and nullable run snapshots; select an effective published provider/model price in the completion transaction; reject updates/deletes of history.
- [ ] Run focused tests and typecheck; verify no key, prompt, body, or raw response enters the tables.
- [ ] Commit: `git commit -m "feat: record immutable model token costs"`.

### Task 3: Service-Provider Price Console And Global Aggregates

**Files:**
- Create: `services/api/src/model-pricing/repository.ts`
- Create: `services/api/src/model-pricing/routes.ts`
- Create: `services/api/test/model-pricing-routes.test.ts`
- Modify: `services/api/src/server.ts`
- Modify: `apps/provider-console/src/api.ts`
- Modify: `apps/provider-console/src/app.tsx`
- Create: `apps/provider-console/src/model-pricing.tsx`
- Create: `apps/provider-console/src/model-pricing.test.tsx`

- [ ] Write failing tests for draft/create/publish price versions and provider/model/date aggregate totals. Assert returned objects contain no task, enterprise, store, actor, prompt, copy, review, media, URL, or object key; assert customer/unrelated role 403.
- [ ] Run `npm test -- --run test/model-pricing-routes.test.ts` and confirm RED.
- [ ] Implement a dedicated pricing capability, price draft/publish routes, global aggregate query, and console form with input/output CNY-per-million values and effective time.
- [ ] Run focused API tests/typecheck and `cd apps/provider-console; npm test; npm run build`.
- [ ] Commit: `git commit -m "feat: manage model token pricing"`.

### Task 4: Customer-Only Usage Summary

**Files:**
- Modify: `services/api/src/content-planning/workflow-routes.ts`
- Modify: `services/api/test/content-planning-workflow.test.ts`
- Modify: `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationApi.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationModels.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationScreen.kt`
- Modify: `apps/android/app/src/test/java/com/restaurantops/content/ContentCreationApiTest.kt`

- [ ] Write failing API tests for current-customer monthly aggregate input/output/total tokens, CNY estimated cost, and call count; reject other customers and service roles; assert no per-run or raw-content fields.
- [ ] Run focused workflow tests and confirm RED.
- [ ] Add customer-scoped aggregate endpoint, typed Android mapping, and compact queue summary; do not expose key, price configuration, or other-customer usage.
- [ ] Run focused API/Android tests with `ANDROID_HOME=C:\Users\50633\AppData\Local\Android\Sdk` and typecheck.
- [ ] Commit: `git commit -m "feat: show customer model usage summary"`.

### Task 5: Verification And Deployment Documentation

**Files:**
- Modify: `.env.example`
- Create: `docs/operations/model-provider-pricing.md`

- [ ] Document server-local secret entry, newly generated key requirement, `store:false`, HTTPS gateway, price publication, CNY-per-million unit, and synthetic gateway health check with no customer content.
- [ ] Run `cd services/api; npm test; npm run typecheck`.
- [ ] Run `cd apps/provider-console; npm test; npm run build`.
- [ ] Run Android unit/build with SDK environment variables, then `git diff --check` and `git status --short`.
- [ ] Commit: `git commit -m "docs: document model provider pricing operations"`.
