# Data Import Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可本机运行的 CSV/XLSX、手工补录、异常确认和事实版本服务端链路，并接入 Android 导入确认界面。

**Architecture:** `services/api` 用 Fastify、PostgreSQL 和 SQL 迁移保存导入批次、候选指标与事实版本。Android 通过 `ImportRepository` 接入，UI 只读取来源、范围、单位、置信度和确认状态；未确认值无法形成事实版本。

**Tech Stack:** Node.js 22、TypeScript、Fastify、pg、xlsx、Vitest、PostgreSQL 16、MinIO、Docker Compose、Kotlin、Retrofit、Jetpack Compose、JUnit 4。

---

## File Map

- `docker-compose.yml` and `.env.example`: local PostgreSQL, MinIO, API configuration.
- `services/api/src/server.ts`, `db.ts`: Fastify composition and database boundary.
- `services/api/migrations/001_imports.sql`: import batches, candidates, fact versions and values.
- `services/api/src/imports/`: models, parser, service and route modules.
- `services/api/test/`: API parser, schema and route tests.
- `apps/android/app/src/main/java/com/restaurantops/imports/`: API models, repository, ViewModel and screens.
- `apps/android/app/src/test/java/com/restaurantops/imports/`: Android state tests.

### Task 1: Bootstrap API and Local Services

**Files:** Create `docker-compose.yml`, `.env.example`, `services/api/package.json`, `services/api/tsconfig.json`, `services/api/src/server.ts`, `services/api/test/health.test.ts`.

- [ ] **Step 1: Write failing health test**

```ts
it("returns service status", async () => {
  const response = await buildServer({ databaseUrl: undefined }).inject({ method: "GET", url: "/health" });
  expect(response.json()).toEqual({ status: "ok" });
});
```

- [ ] **Step 2: Verify red**

Run `npm --prefix services/api test -- health.test.ts`; expect failure because `buildServer` is absent.

- [ ] **Step 3: Implement minimum runtime**

Create `buildServer(options)` with Fastify and `GET /health -> { status: "ok" }`. Compose contains PostgreSQL 16, MinIO, API and named volumes. `.env.example` contains only non-secret defaults; Docker/production credentials stay untracked.

- [ ] **Step 4: Verify and commit**

Run `npm --prefix services/api test -- health.test.ts`; expect pass. Commit `feat(api): bootstrap local import services`.

### Task 2: Create Import Schema and Repository

**Files:** Create `services/api/migrations/001_imports.sql`, `services/api/src/db.ts`, `services/api/src/imports/repository.ts`, `services/api/test/schema.test.ts`.

- [ ] **Step 1: Write failing batch test**

```ts
it("creates a store-scoped pending batch", async () => {
  const batch = await imports.createBatch({ enterpriseId: "ent_demo", storeId: "store_demo", actorId: "actor_demo", sourceType: "manual" });
  expect(batch.status).toBe("pending_confirmation");
});
```

- [ ] **Step 2: Verify red**

Run `npm --prefix services/api test -- schema.test.ts`; expect failure because the repository is absent.

- [ ] **Step 3: Implement schema**

Create `import_batches`, `import_candidates`, `fact_versions`, `fact_values`. Every table carries enterprise/store identity and timestamps. Candidate values store metric key, display name, integer minimal-unit value, unit, range, source locator, confidence, issue code, status and confirmed value. Fact version values are appended, never overwrite historic versions.

- [ ] **Step 4: Verify and commit**

Run `npm --prefix services/api test -- schema.test.ts`; expect pass. Commit `feat(api): add import confirmation schema`.

### Task 3: Parse CSV/XLSX Candidates

**Files:** Create `services/api/src/imports/models.ts`, `parser.ts`, `services/api/test/parser.test.ts`.

- [ ] **Step 1: Write failing mapping tests**

```ts
it("maps standard yuan revenue to cents with confidence 100", () => {
  expect(parseRows([{ "营业额（元）": "48260" }], range).candidates[0]).toMatchObject({ metricKey: "revenue", value: 4826000, unit: "cents", confidence: 100, status: "ready" });
});
it("marks missing unit for confirmation", () => {
  expect(parseRows([{ "客单价": "38" }], range).candidates[0]).toMatchObject({ status: "needs_confirmation", issueCode: "unit_missing" });
});
```

- [ ] **Step 2: Verify red**

Run `npm --prefix services/api test -- parser.test.ts`; expect failure because `parseRows` is absent.

- [ ] **Step 3: Implement deterministic parsing**

Use `xlsx` for CSV/first-XLSX-sheet. Support revenue, orders, average spend, package sales, redemptions, refunds and promotion spend. Standard complete headers score 100, aliases/context units score 80, and missing unit/bad value/invalid range/nonpositive protected metric/disallowed negative score 0 and require confirmation. Preserve unknown columns without creating fact candidates.

- [ ] **Step 4: Verify and commit**

Run `npm --prefix services/api test -- parser.test.ts`; expect pass. Commit `feat(api): parse restaurant import candidates`.

### Task 4: Add Import Confirmation API

**Files:** Create `services/api/src/imports/service.ts`, `routes.ts`, `services/api/test/import-routes.test.ts`; modify `services/api/src/server.ts`.

- [ ] **Step 1: Write failing confirm test**

```ts
it("creates a fact version only from confirmed candidates", async () => {
  const batch = await createManualImport();
  const response = await confirmImport(batch.id, [batch.candidates[0].id]);
  expect(response.factVersion.status).toBe("confirmed");
});
```

- [ ] **Step 2: Verify red**

Run `npm --prefix services/api test -- import-routes.test.ts`; expect failure because routes are absent.

- [ ] **Step 3: Implement APIs**

Implement `POST file`, `POST manual`, `GET import`, `PATCH candidate`, `POST confirm`, `GET latest facts` under `/v1/stores/:storeId`. Use fixed local development identity, but derive enterprise/store/actor only from request context, not bodies. Enforce store mismatch as 403. Confirmation rejects unresolved candidates and returns 404 for no latest fact version.

- [ ] **Step 4: Verify and commit**

Run `npm --prefix services/api test -- import-routes.test.ts`; expect pass. Commit `feat(api): add import confirmation endpoints`.

### Task 5: Add Android Import State Boundary

**Files:** Create `apps/android/app/src/main/java/com/restaurantops/imports/ImportModels.kt`, `ImportRepository.kt`, `ImportViewModel.kt`, `apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt`; modify Android app Gradle file.

- [ ] **Step 1: Write failing separation test**

```kotlin
@Test fun `unresolved candidates remain outside bulk confirmation`() {
  val vm = ImportViewModel(FakeImportRepository(summaryWithReadyAndUnresolved))
  vm.load("store_demo", "import_1")
  assertEquals(listOf("candidate_ready"), vm.readyCandidateIds)
  assertEquals(listOf("candidate_unresolved"), vm.unresolvedCandidateIds)
}
```

- [ ] **Step 2: Verify red**

Run `.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.imports.ImportViewModelTest' '--no-daemon'`; expect missing ViewModel failure.

- [ ] **Step 3: Implement interface and ViewModel**

Define `ImportCandidate`, `ImportSummary`, `FactVersion`, and repository methods `loadImport`, `createManualImport`, `updateCandidate`, `confirm`. Use a fake in tests. Keep base URL/credentials outside Compose. Add Retrofit only after the interface passes.

- [ ] **Step 4: Verify and commit**

Run focused Android test; expect pass. Commit `feat(android): add import confirmation state`.

### Task 6: Connect Android Confirmation UI

**Files:** Create `ImportScreens.kt`; modify `WorkspaceScreens.kt`, `WorkspaceViewModel.kt`, `ImportViewModelTest.kt`.

- [ ] **Step 1: Write failing candidate-edit test**

```kotlin
@Test fun `editing unresolved candidate leaves confirmed-ready candidate unchanged`() {
  val vm = ImportViewModel(FakeImportRepository(summaryWithReadyAndUnresolved)); vm.load("store_demo", "import_1")
  vm.editCandidate("candidate_unresolved", 3800, "cents")
  assertEquals(3800, vm.summary.candidate("candidate_unresolved").value)
  assertEquals(4826000, vm.summary.candidate("candidate_ready").value)
}
```

- [ ] **Step 2: Verify red, implement and verify green**

Run the Task 5 focused command. Add workspace `导入经营数据` entry, source picker, manual entry, summary counts, ready bulk-confirm action, per-candidate edit and separate unresolved list. Each unresolved item says `待确认，尚未用于诊断`; successful confirmation says only `已生成确认数据版本`.

- [ ] **Step 3: Commit**

Commit `feat(android): add import confirmation UI`.

### Task 7: Verify Stack and Milestone

**Files:** Modify only files where a test exposes a defect.

- [ ] **Step 1: Run all checks**

Run `npm --prefix services/api test`, `docker compose --env-file .env.example up -d postgres minio`, `docker compose ps`, then Android unit tests plus `assembleDebug` with the existing JDK 17/Android SDK environment. Run `git diff --check`.

- [ ] **Step 2: Review and commit fixes**

Review secret handling, enterprise/store isolation, unit conversion, unresolved-candidate exclusion and Android wording. Resolve proven issues, repeat Step 1, and commit focused fixes.
