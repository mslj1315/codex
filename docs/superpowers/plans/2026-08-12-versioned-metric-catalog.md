# Versioned Metric Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a publishable metric catalog that preserves existing metric semantics, binds confirmed facts to the active catalog version, and exposes only the current enabled definitions to a trusted store client.

**Architecture:** Migration 009 seeds an immutable published v1 catalog. `MetricCatalogRepository` owns draft/edit/publish transactions and current-catalog reads; the import confirmation transaction resolves the published catalog and validates candidates against it. Operator mutations stay behind an explicitly injected service and are not registered by the normal store server.

**Tech Stack:** PostgreSQL, TypeScript, Fastify, Vitest/pg-mem, Kotlin, Retrofit, JUnit 4.

---

## File Map

- `services/api/migrations/009_metric_catalog.sql`: catalog tables, v1 seed, fact-version foreign key.
- `services/api/src/metrics/repository.ts`: catalog types and draft/publish/current read operations.
- `services/api/src/metrics/operator-service.ts`: explicit operator mutation facade, not a public store route.
- `services/api/src/imports/repository.ts`: confirmation resolves catalog with the existing transaction client.
- `services/api/src/imports/service.ts`: removes hard-coded confirmation metric validation.
- `services/api/src/imports/routes.ts`: trusted-store read-only catalog endpoint.
- `services/api/test/metric-catalog.test.ts`: catalog lifecycle and confirmation binding tests.
- `services/api/test/schema.test.ts`: migration declaration/seed assertions.
- `services/api/test/import-routes.test.ts`: public catalog shape/privacy test.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt`: public catalog Retrofit DTO.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt`: catalog mapping method.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/LocalImportApiRuntime.kt`: unavailable-mode implementation if needed by the existing repository boundary.
- `apps/android/app/src/test/java/com/restaurantops/imports/network/HttpImportRepositoryTest.kt`: public DTO mapping/path/privacy test.

### Task 1: Create and Seed the Immutable v1 Catalog

**Files:** Create `services/api/migrations/009_metric_catalog.sql`; modify `services/api/test/schema.test.ts`.

- [ ] Write a failing schema test asserting the migration declares catalog states, one published catalog, definition uniqueness, unit-kind constraints, and `fact_versions.metric_catalog_version_id`:

```ts
expect(migration).toContain("CREATE TABLE metric_catalog_versions");
expect(migration).toContain("state IN ('draft', 'published', 'retired')");
expect(migration).toContain("metric_catalog_one_published_idx");
expect(migration).toContain("UNIQUE (metric_catalog_version_id, metric_key)");
expect(migration).toContain("metric_catalog_version_id TEXT NOT NULL");
```

- [ ] Run `npm test -- schema.test.ts` in `services/api`; expected red because migration 009 is absent.

- [ ] Create migration 009. Create `metric_catalog_versions` with `id`, integer `version_number`, state, created/published timestamps, `UNIQUE(version_number)`, and partial unique index for `state = 'published'`. Create `metric_definitions` with `metric_catalog_version_id`, `metric_key`, `display_name`, `value_kind`, `storage_unit`, `allow_negative`, `require_positive`, three eligibility flags, `enabled`, and checks:

```sql
CHECK ((value_kind = 'amount' AND storage_unit = 'cents')
    OR (value_kind = 'count' AND storage_unit = 'count')
    OR (value_kind = 'ratio' AND storage_unit = 'basis_points')),
CHECK (NOT require_positive OR NOT allow_negative),
UNIQUE (metric_catalog_version_id, metric_key)
```

- [ ] Seed one published `v1` row and the seven definitions exactly as documented. Add `metric_catalog_version_id TEXT` to `fact_versions`, backfill existing fact rows with v1, set `NOT NULL`, and add a foreign key to `metric_catalog_versions(id)`.

- [ ] Run `npm test -- schema.test.ts`; expected green.

- [ ] Commit:

```powershell
git add services/api/migrations/009_metric_catalog.sql services/api/test/schema.test.ts
git commit -m "feat(api): add versioned metric catalog schema"
```

### Task 2: Implement Draft, Publish, and Current Catalog Reads

**Files:** Create `services/api/src/metrics/repository.ts`; create `services/api/src/metrics/operator-service.ts`; create `services/api/test/metric-catalog.test.ts`.

- [ ] Write failing lifecycle tests using pg-mem migrations:

```ts
const draft = await catalog.createDraftFromPublished();
await catalog.upsertDraftDefinition(draft.id, {
  metricKey: "lunch_orders", displayName: "Lunch orders", valueKind: "count",
  storageUnit: "count", allowNegative: false, requirePositive: true,
  usableForReadiness: false, usableForDiagnostic: false,
  usableForVerification: false, enabled: true
});
await catalog.publishDraft(draft.id);
expect((await catalog.getCurrentCatalog()).definitions).toContainEqual(
  expect.objectContaining({ metricKey: "lunch_orders", enabled: true })
);
```

Also assert: published definitions reject updates; duplicate keys reject; invalid kind/unit and contradictory domain flags reject; disabling `revenue`, `orders`, or `average_spend` for readiness causes publish rejection; publish retires v1 and leaves exactly one published version.

- [ ] Run `npm test -- metric-catalog.test.ts`; expected red because the module is absent.

- [ ] Define and implement:

```ts
export type MetricValueKind = "amount" | "count" | "ratio";
export type MetricStorageUnit = "cents" | "count" | "basis_points";
export interface MetricDefinition { /* public definition fields from spec */ }
export interface MetricCatalog { id: string; versionNumber: number; definitions: MetricDefinition[]; }
```

`createDraftFromPublished` uses one transaction, locks the current published row, creates the next sequential draft, and copies all definitions. `upsertDraftDefinition` validates identifiers with `/^[a-z][a-z0-9_]{0,63}$/`, validates kind/unit/domain, verifies the catalog is draft, then upserts by `(metric_catalog_version_id, metric_key)`. `publishDraft` locks the draft and current published row, verifies every core key is enabled and readiness-usable, updates the previous published row to `retired`, then updates the draft to `published` in the same transaction. `getCurrentCatalog` reads only the one published version and enabled definitions ordered by `metric_key`.

- [ ] `MetricCatalogOperatorService` delegates these three mutation methods and requires construction with a `MetricCatalogRepository`; do not modify `buildServer` or register an HTTP operator route.

- [ ] Run `npm test -- metric-catalog.test.ts` and `npm run typecheck`; expected green.

- [ ] Commit:

```powershell
git add services/api/src/metrics/repository.ts services/api/src/metrics/operator-service.ts services/api/test/metric-catalog.test.ts
git commit -m "feat(api): manage versioned metric catalogs"
```

### Task 3: Bind Confirmation to the Published Catalog

**Files:** Modify `services/api/src/imports/repository.ts`; modify `services/api/src/imports/service.ts`; modify `services/api/test/metric-catalog.test.ts`.

- [ ] Add failing tests that create a manual batch containing valid `revenue` and `orders`, confirm it, and assert its fact version stores the current catalog ID. Add candidates with a disabled custom definition, an unknown key, a mismatched unit, a negative value, and zero for `orders`; each must reject confirmation and leave the batch pending.

- [ ] Run `npm test -- metric-catalog.test.ts`; expected red because confirmation still uses `metricUnits` and does not write a catalog ID.

- [ ] Add `resolvePublishedMetricDefinitions(client)` on `MetricCatalogRepository`, returning a keyed map of enabled definitions with `FOR SHARE`. In `ImportRepository.confirmBatch`, instantiate a transaction-scoped catalog repository from the existing client after candidate locking. Require an enabled definition for each candidate and validate exact unit, JSON-safe integer, nonnegative/positive domain rules before inserting facts. Insert `metric_catalog_version_id` into `fact_versions` from the published catalog.

- [ ] Remove `MetricKey`, `metricUnits`, `strictlyPositive`, and `validateResolvedCandidate` from `service.ts`. Keep structural manual candidate checks; semantic validation occurs only during confirmation against the catalog.

- [ ] Run `npm test -- metric-catalog.test.ts` and `npm run typecheck`; expected green.

- [ ] Commit:

```powershell
git add services/api/src/imports/repository.ts services/api/src/imports/service.ts services/api/src/metrics/repository.ts services/api/test/metric-catalog.test.ts
git commit -m "feat(api): bind confirmed facts to metric catalog"
```

### Task 4: Expose the Published Catalog to Trusted Store Clients

**Files:** Modify `services/api/src/imports/service.ts`; modify `services/api/src/imports/routes.ts`; modify `services/api/test/import-routes.test.ts`.

- [ ] Write a failing route test:

```ts
const response = await app.inject({ method: "GET", url: "/v1/stores/store_demo/metric-catalog" });
expect(response.statusCode).toBe(200);
expect(response.json()).toMatchObject({
  versionNumber: 1,
  definitions: [expect.objectContaining({ metricKey: "revenue", storageUnit: "cents", usableForDiagnostic: true })]
});
expect(response.body).not.toMatch(/id|draft|retired|actor|batch|candidate|objectKey/);
```

- [ ] Run `npm test -- import-routes.test.ts`; expected red because the endpoint is absent.

- [ ] Add `getPublishedMetricCatalog()` to `ImportService`, delegating to `MetricCatalogRepository.getCurrentCatalog()`. Add `GET /v1/stores/:storeId/metric-catalog` within existing trusted import routes. Map to `{ versionNumber, definitions }`, omitting catalog/database IDs and lifecycle fields.

- [ ] Run `npm test -- import-routes.test.ts` and `npm run typecheck`; expected green.

- [ ] Commit:

```powershell
git add services/api/src/imports/service.ts services/api/src/imports/routes.ts services/api/test/import-routes.test.ts
git commit -m "feat(api): expose published metric catalog"
```

### Task 5: Map the Read-Only Catalog on Android

**Files:** Modify `apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt`; modify `apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt`; modify the unavailable repository implementation identified by `rg -n "class Unavailable|: ImportRepository" apps/android/app/src/main/java/com/restaurantops/imports`; modify `apps/android/app/src/test/java/com/restaurantops/imports/network/HttpImportRepositoryTest.kt`.

- [ ] Write a failing Retrofit/repository test:

```kotlin
val catalog = repository.loadMetricCatalog("store_demo")
assertEquals(1, catalog.versionNumber)
assertEquals("cents", catalog.definitions.single { it.metricKey == "revenue" }.storageUnit)
assertNull(MetricCatalogResponse::class.java.declaredFields.singleOrNull { it.name == "id" })
assertNull(MetricDefinitionResponse::class.java.declaredFields.singleOrNull { it.name == "draft" })
```

Also assert `@GET("/v1/stores/{storeId}/metric-catalog")` and that the unavailable implementation throws the existing typed service-unavailable error.

- [ ] Run the focused Android test command; expected red because DTOs and the repository method are absent.

- [ ] Add only public DTO/domain fields: version number; metric key/display name/value kind/storage unit; the three eligibility flags. Map with existing HTTP error boundaries. Do not alter the current Android import editor or its manual unit behavior in this increment.

- [ ] Run the focused Android test command; expected green.

- [ ] Commit:

```powershell
git add apps/android/app/src/main/java/com/restaurantops/imports/network apps/android/app/src/test/java/com/restaurantops/imports/network/HttpImportRepositoryTest.kt
git commit -m "feat(android): read published metric catalog"
```

### Task 6: Full Verification and Delivery

- [ ] Run API verification in `services/api`:

```powershell
npm test
npm run typecheck
npm audit --audit-level=high
```

- [ ] Run Android verification from the repository root:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' ':apps:android:app:assembleDebug' ':apps:android:app:assembleRelease' '--no-daemon' '--console=plain'
docker compose config --quiet
docker compose --profile maintenance config --quiet
```

- [ ] Inspect scope and push:

```powershell
rg -n "POS|ERP|membership|delivery|platform|objectKey|sourceBatchId|sourceCandidateId|factVersionId" services/api/src/metrics services/api/src/imports/routes.ts apps/android/app/src/main/java/com/restaurantops/imports/network
git diff --check
git status --short
git push origin feature/android-import-api
```
