# Douyin Official Data Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual-report feedback as the normal path with authorised Douyin official content and life-service data collection, task association, immutable period snapshots, and privacy-bounded aggregate visibility.

**Architecture:** Keep Douyin-specific OAuth, token refresh, API collection, and raw-response parsing in server-only adapters. A connection service turns both account and life-service sources into normalised observations; a snapshot service creates immutable 3/7/14 day aggregates. Existing manual import remains an administrator-enabled fallback whose source cannot silently mix with official data.

**Tech Stack:** TypeScript, Fastify, PostgreSQL migrations, Vitest, React/TypeScript provider console, Kotlin/Jetpack Compose and existing Android HTTP abstractions.

---

## File Structure

- `services/api/migrations/017_douyin_official_connections.sql`: encrypted connection/token metadata, OAuth state, work association, observations, snapshots, sync runs, and manual/official source conflict constraints.
- `services/api/src/douyin-official/connection-repository.ts`: scoped persistence, encrypted-token access, state consumption, locks, and connection state transitions.
- `services/api/src/douyin-official/client.ts`: injected official HTTP contract; no routes or credentials in clients.
- `services/api/src/douyin-official/oauth-service.ts`: start/callback/refresh and neutral error categorisation.
- `services/api/src/douyin-official/sync-service.ts`: daily/manual sync, bounded retry classification, normalisation, and availability semantics.
- `services/api/src/douyin-official/association-service.ts`: official callback, official work selection, and verified-link association.
- `services/api/src/douyin-official/routes.ts`: authenticated customer endpoints; never exposes tokens/raw responses.
- `services/api/src/douyin-official/provider-results.ts`: confirmed aggregate projection for provider roles only.
- `services/api/test/douyin-official-*.test.ts`: repository, OAuth, sync, association, visibility, and route contracts.
- `apps/android/app/src/main/java/com/restaurantops/content/DouyinConnection*.kt`: customer connection/effect read models and repository/view-model UI.
- `apps/provider-console/src/content-planning/douyin-connection*.tsx`: customer connection/effect workflow and provider aggregate read-only view, where those shells exist.
- `docs/operations/douyin-official-data.md`: official capability, TLS, encryption, scheduler, renewal, and fallback operation guidance.

### Task 1: Persist Scoped Official Connections And OAuth State

**Files:**
- Create: `services/api/migrations/017_douyin_official_connections.sql`
- Create: `services/api/src/douyin-official/connection-repository.ts`
- Create: `services/api/test/douyin-official-connection-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Test a `content_account` and `life_service_store` connection for the same store, one-time expiring state consumption, encrypted token ciphertext only, and rejection of a state used by another enterprise/store.

```ts
expect(await repository.consumeOAuthState({ state, enterpriseId: "e2", storeId: "s1" })).toBeNull();
expect(await repository.consumeOAuthState({ state, enterpriseId: "e1", storeId: "s1" })).toMatchObject({ connectionType: "content_account" });
expect(await repository.consumeOAuthState({ state, enterpriseId: "e1", storeId: "s1" })).toBeNull();
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- --run test/douyin-official-connection-repository.test.ts`

Expected: FAIL because migration and repository do not exist.

- [ ] **Step 3: Implement append-only schema and scoped repository**

Create `douyin_data_connections`, `douyin_oauth_states`, and `douyin_sync_runs`. Connection types are `content_account | life_service_store`; states are `active | reauthorization_required | disconnected`. Store only `access_token_ciphertext`, `refresh_token_ciphertext`, `expires_at`, grants, and neutral diagnostics. Use a transaction to consume a non-expired state exactly once.

```ts
async consumeOAuthState(input: OAuthStateScope): Promise<OAuthState | null> {
  return this.database.withConnection(async (client) => {
    const result = await client.query<OAuthState>(`UPDATE douyin_oauth_states
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE state_hash = $1 AND enterprise_id = $2 AND store_id = $3
        AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
      RETURNING connection_type, redirect_path`, [hash(input.state), input.enterpriseId, input.storeId]);
    return result.rows[0] ?? null;
  });
}
```

- [ ] **Step 4: Verify focused tests and commit**

Run: `npm test -- --run test/douyin-official-connection-repository.test.ts && npm run typecheck && git diff --check`

Expected: PASS.

Commit: `git commit -am "feat: persist Douyin official data connections"`

### Task 2: Implement Server-Only OAuth And Token Lifecycle

**Files:**
- Create: `services/api/src/douyin-official/client.ts`
- Create: `services/api/src/douyin-official/oauth-service.ts`
- Create: `services/api/src/douyin-official/routes.ts`
- Create: `services/api/test/douyin-official-oauth.test.ts`
- Modify: `services/api/src/server.ts`, `.env.example`

- [ ] **Step 1: Write failing OAuth route/service tests**

Cover scoped start redirect, callback state mismatch, token encryption, refresh before expiry, revoked refresh becoming `reauthorization_required`, and routes returning capability summary but never token fields.

```ts
expect(response.json()).toEqual({
  connection: expect.objectContaining({ state: "active", capabilities: expect.any(Array) })
});
expect(JSON.stringify(response.json())).not.toContain("access_token");
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run test/douyin-official-oauth.test.ts`

Expected: FAIL because routes and service do not exist.

- [ ] **Step 3: Add an injected official client and OAuth service**

Define `DouyinOfficialClient.exchangeCode`, `refreshToken`, `listWorks`, and source collection methods. Validate official base URL as HTTPS configuration. Encrypt only server-side token material with an application encryption key. Classify revoked/permission failures as non-retryable and retain only neutral client-facing categories.

```ts
export interface DouyinOfficialClient {
  exchangeCode(input: CodeExchange): Promise<TokenGrant>;
  refreshToken(input: RefreshGrant): Promise<TokenGrant>;
  listWorks(input: WorkListRequest): Promise<OfficialWork[]>;
}
```

- [ ] **Step 4: Register scoped authenticated routes and verify**

Expose `POST /v1/stores/:storeId/douyin-connections/:type/oauth/start`, official callback handling, `GET /v1/stores/:storeId/douyin-connections`, and reconnect routes. Preserve Android authentication and do not add provider access to token routes.

Run: `npm test -- --run test/douyin-official-oauth.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `git commit -am "feat: add Douyin official OAuth connections"`

### Task 3: Associate Published Works Without Automatic Publishing

**Files:**
- Create: `services/api/src/douyin-official/association-service.ts`
- Create: `services/api/test/douyin-official-association.test.ts`
- Modify: `services/api/src/douyin-official/routes.ts`, migration 017

- [ ] **Step 1: Write failing association tests**

Cover official callback binding, recent-work selection, verified-link fallback, connection/store validation, and rejection of timestamp-only inference.

```ts
expect(await service.associateFromTimestamp({ taskId, publishedAt })).toEqual({ kind: "rejected" });
expect(await service.associateSelectedWork({ taskId, workId, actor })).toMatchObject({ method: "official_selection" });
```

- [ ] **Step 2: Implement association records and commands**

Persist `content_task_id`, official work ID, connection ID/version, method, actor, and time. Create a short-lived publish-association session before external navigation. Accept a pasted link only after server parsing and an authorised work/connection check.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- --run test/douyin-official-association.test.ts && npm run typecheck && git diff --check`

Expected: PASS.

Commit: `git commit -am "feat: associate content tasks with Douyin works"`

### Task 4: Sync, Normalise, And Freeze Period Snapshots

**Files:**
- Create: `services/api/src/douyin-official/sync-service.ts`
- Create: `services/api/src/douyin-official/snapshot-repository.ts`
- Create: `services/api/test/douyin-official-sync.test.ts`
- Modify: migration 017, routes

- [ ] **Step 1: Write failing sync tests**

Cover daily idempotency, six-hour manual refresh, one connection lock, unavailable-not-zero metrics, source metadata, 3/7/14 immutable snapshots, and manual/official source conflict.

```ts
expect(snapshot.metrics.gmv).toEqual({ availability: "unavailable", reason: "scope_not_granted" });
await expect(repository.replacePeriodSnapshot(snapshot.id, {})).rejects.toThrow("immutable");
```

- [ ] **Step 2: Implement service and scheduler entry point**

Normalise only authorised content and conversion metrics. Retry timeout/transport/429/selected 5xx failures only. Use row-level connection locking; write observations during the active window and append immutable aggregates when a 3/7/14 period closes. Reject conflicting `manual_import` and `douyin_official` sources for the same task/period unless an explicit resolution workflow is added later.

- [ ] **Step 3: Expose customer status/refresh endpoints and verify**

Run: `npm test -- --run test/douyin-official-sync.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

Commit: `git commit -am "feat: sync Douyin official performance snapshots"`

### Task 5: Add Customer/Provider Projections And Retire Manual Import From Main Flow

**Files:**
- Create: `services/api/src/douyin-official/provider-results.ts`
- Create: `services/api/test/douyin-official-visibility.test.ts`
- Modify: Android content repositories/screens, `apps/provider-console/src/content-planning/*`, existing manual import routes/screens, docs

- [ ] **Step 1: Write failing visibility and UI-contract tests**

Prove a provider sees only confirmed aggregate task/product metrics for assigned stores, never tokens/raw/orders/consumers; prove manual import is absent from normal customer navigation and needs an administrator-enabled fallback flag.

- [ ] **Step 2: Implement read models and client screens**

Customer views show separate connection cards, capability/missing-data states, last sync, cooldown, reconnect, association status, and 3/7/14 results. Provider views are read-only aggregate projections. Do not add raw-data download, OAuth management, manual refresh, or work selection to provider views.

- [ ] **Step 3: Verify cross-boundary behaviour and commit**

Run API focused tests, console tests/typecheck/build, Android unit/build verification when SDK is configured, `git diff --check`, and targeted searches for token/raw-data exposure.

Commit: `git commit -am "feat: expose Douyin official aggregate feedback"`

### Task 6: Operations And Release Verification

**Files:**
- Create: `docs/operations/douyin-official-data.md`
- Modify: `.env.example`, relevant architecture/current-gap documentation

- [ ] **Step 1: Document deployment and operations**

Document exact official capability approval prerequisites, HTTPS callback URL, encryption-key rotation, token refresh/reconnect handling, daily scheduler, manual-refresh limit, data retention, fallback flag, and explicit no-auto-publish/no-scraping boundaries.

- [ ] **Step 2: Run final verification**

Run API `npm test`, `npm run typecheck`, and `npm audit --audit-level=high`; console test/typecheck/build; real PostgreSQL migration tests when a dedicated URL is available; Android `:apps:android:app:testDebugUnitTest`, `assembleDebug`, and `assembleRelease` when SDK is configured.

- [ ] **Step 3: Record only actual outcomes and commit**

Run: `git diff --check && git status --short`

Expected: no uncommitted change after documentation commit.

Commit: `git commit -am "docs: document Douyin official data operations"`

## Self-Review

- OAuth, token encryption/refresh, connection separation, association fallback, daily/manual sync, unavailable semantics, period immutability, source conflicts, and provider privacy each map to Tasks 1-5.
- The plan contains no automatic publishing, scraping, POS, customer-order exposure, raw-response projection, or client credential handling.
- Every task starts with a focused failing test, has explicit validation, and commits independently.
