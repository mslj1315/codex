# Action Card Diagnostic Evidence Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open the frozen public diagnostic evidence that originated a linked action card without exposing internal provenance.

**Architecture:** The API adds a scoped `diagnostic_runs` read projection over existing immutable run and evidence rows. Android maps that projection into a domain type and loads it only for selected linked cards, independently of verification-summary state. Manual cards never trigger the read and errors clear only stale diagnostic detail.

**Tech Stack:** PostgreSQL, TypeScript, Fastify, Vitest/pg-mem, Kotlin, Retrofit, Compose, JUnit 4.

---

## File Map

- `services/api/src/imports/repository.ts`: public diagnostic-run detail type and scoped immutable read.
- `services/api/src/imports/service.ts`: trusted-context read delegation.
- `services/api/src/imports/routes.ts`: one store-scoped GET endpoint.
- `services/api/test/data-readiness.test.ts`: repository projection, ordering, and scope tests.
- `services/api/test/import-routes.test.ts`: public HTTP shape and no-internal-field regression.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsApi.kt`: Retrofit detail DTO and endpoint.
- `apps/android/app/src/main/java/com/restaurantops/operations/HttpOperationsRepository.kt`: domain model and mapping.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt`: unavailable repository implementation.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsViewModel.kt`: selection-time detail state/loading behavior.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt`: recorded-evidence display below selected linked card.
- `apps/android/app/src/test/java/com/restaurantops/operations/HttpOperationsRepositoryTest.kt`: mapping/privacy test.
- `apps/android/app/src/test/java/com/restaurantops/operations/OperationsViewModelTest.kt`: no-fetch, replacement, and failure behavior.
- `apps/android/app/src/test/java/com/restaurantops/operations/OperationsScreenTest.kt`: public evidence formatting test.

### Task 1: Read a Scoped Public Diagnostic Run

**Files:** Modify `services/api/src/imports/repository.ts`; modify `services/api/test/data-readiness.test.ts`.

- [ ] Write a failing repository test that first obtains a persisted diagnostic, then calls `getDiagnosticRun` and expects only the immutable public projection:

```ts
const detail = await imports.getDiagnosticRun({
  id: diagnostic!.diagnosticRunId, enterpriseId: "ent_demo", storeId: "store_demo"
});
expect(detail).toMatchObject({
  id: diagnostic!.diagnosticRunId, kind: "revenue_decline", ruleVersion: "revenue_decline_v1",
  evidence: [{ metricKey: "revenue", currentValue: 3826000, priorValue: 4400000, changePercent: -13.05 }]
});
expect(JSON.stringify(detail)).not.toMatch(/snapshot|factVersion|sourceBatch|sourceCandidate|objectKey/);
```

- [ ] Add a cross-store read assertion and expect `NotFoundError`:

```ts
await expect(imports.getDiagnosticRun({
  id: diagnostic!.diagnosticRunId, enterpriseId: "ent_demo", storeId: "store_other"
})).rejects.toBeInstanceOf(NotFoundError);
```

- [ ] Run `npm test -- data-readiness.test.ts` in `services/api`; expected red because `getDiagnosticRun` is absent.

- [ ] Add the exported public types:

```ts
export interface DiagnosticRunDetail {
  id: string; kind: "revenue_decline"; rangeStart: string; rangeEnd: string;
  priorRangeStart: string; priorRangeEnd: string; ruleVersion: string;
  confidence: "high" | "medium"; createdAt: Date; evidence: DiagnosticEvidence[];
}
```

- [ ] Implement the read with two scoped queries. The first reads only `diagnostic_runs` using `id`, `enterprise_id`, and `store_id`; when `rowCount !== 1`, throw `new NotFoundError("Diagnostic run not found for enterprise and store")`. The second reads evidence by the same `diagnostic_run_id`, `enterprise_id`, and `store_id`, ordered by `metric_key`, and maps only `metricKey`, `currentValue`, `priorValue`, and `changePercent`. Do not query `fact_values`.

- [ ] Run `npm test -- data-readiness.test.ts` and `npm run typecheck`; expected green.

- [ ] Commit:

```powershell
git add services/api/src/imports/repository.ts services/api/test/data-readiness.test.ts
git commit -m "feat(api): read diagnostic evidence details"
```

### Task 2: Expose the Detail Through the Store-Scoped API

**Files:** Modify `services/api/src/imports/service.ts`; modify `services/api/src/imports/routes.ts`; modify `services/api/test/import-routes.test.ts`.

- [ ] Write a failing route test that creates and confirms current/prior revenue facts, gets the deterministic diagnostic, then reads its detail:

```ts
const response = await app.inject({
  method: "GET",
  url: `/v1/stores/store_demo/diagnostic-runs/${diagnostic.diagnosticRunId}`
});
expect(response.statusCode).toBe(200);
expect(response.json()).toMatchObject({
  id: diagnostic.diagnosticRunId, ruleVersion: "revenue_decline_v1",
  evidence: [expect.objectContaining({ metricKey: "revenue" })]
});
expect(response.body).not.toMatch(/snapshot|factVersion|sourceBatch|sourceCandidate|objectKey/);
```

- [ ] In the same test, request the ID under `/v1/stores/store_other/...` and expect the existing trusted-context `403`, then request a missing ID in `store_demo` and expect `404`. The repository test in Task 1 verifies that an in-scope lookup cannot read another store's row.

- [ ] Run `npm test -- import-routes.test.ts`; expected red because the route is absent.

- [ ] Add to `ImportService`:

```ts
getDiagnosticRun(context: TrustedContext, id: string) {
  return this.imports.getDiagnosticRun({ id, enterpriseId: context.enterpriseId, storeId: context.storeId });
}
```

- [ ] Register the GET route before the action-card detail routes:

```ts
app.get("/v1/stores/:storeId/diagnostic-runs/:diagnosticRunId", async (request) =>
  service.getDiagnosticRun(scopedContext(request), stringParam(request, "diagnosticRunId"))
);
```

- [ ] Run `npm test -- import-routes.test.ts` and `npm run typecheck`; expected green.

- [ ] Commit:

```powershell
git add services/api/src/imports/service.ts services/api/src/imports/routes.ts services/api/test/import-routes.test.ts
git commit -m "feat(api): expose diagnostic evidence details"
```

### Task 3: Map Detail and Load It Only for Linked Cards

**Files:** Modify `OperationsApi.kt`, `HttpOperationsRepository.kt`, `OperationsRuntime.kt`, `OperationsViewModel.kt`; modify `HttpOperationsRepositoryTest.kt`, `OperationsViewModelTest.kt`.

- [ ] Write failing Android mapping assertions:

```kotlin
val detail = repository.loadDiagnosticRun("store_demo", "diagnostic_run_1")
assertEquals("revenue_decline_v1", detail.ruleVersion)
assertEquals(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05), detail.evidence.single())
assertNull(DiagnosticRunResponse::class.java.declaredFields.singleOrNull { it.name == "factVersionId" })
assertNull(DiagnosticRunResponse::class.java.declaredFields.singleOrNull { it.name == "objectKey" })
```

- [ ] Write failing ViewModel tests using a fake repository with request counters:

```kotlin
viewModel.loadActionCardDetails("store_demo", linkedCard)
advanceUntilIdle()
assertEquals(linkedDetail, viewModel.selectedDiagnosticRun)
assertEquals(1, repository.diagnosticRunRequests)

viewModel.loadActionCardDetails("store_demo", manualCard)
advanceUntilIdle()
assertNull(viewModel.selectedDiagnosticRun)
assertEquals(1, repository.diagnosticRunRequests)
```

Also verify a second linked selection replaces the first detail, and a detail request failure clears only `selectedDiagnosticRun`, retains `verificationSummary`, and sets `"Unable to load operations data"`.

- [ ] Run:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.operations.HttpOperationsRepositoryTest' '--tests' 'com.restaurantops.operations.OperationsViewModelTest' '--no-daemon' '--console=plain'
```

Expected red because the Retrofit DTO, repository method, and state are absent.

- [ ] Add one Retrofit API method and DTO containing only the public projection:

```kotlin
@GET("/v1/stores/{storeId}/diagnostic-runs/{diagnosticRunId}")
suspend fun diagnosticRun(@Path("storeId") storeId: String, @Path("diagnosticRunId") diagnosticRunId: String): DiagnosticRunResponse

data class DiagnosticRunResponse(
    val id: String, val kind: String, val rangeStart: String, val rangeEnd: String,
    val priorRangeStart: String, val priorRangeEnd: String, val ruleVersion: String,
    val confidence: String, val createdAt: String, val evidence: List<DiagnosticEvidenceResponse>
)
```

- [ ] Add `DiagnosticRunDetail`, `loadDiagnosticRun`, Retrofit mapping, and an unavailable-repository override that throws the existing `OperationsServiceUnavailableException`.

- [ ] Extend `OperationsViewModel` with `selectedDiagnosticRun: DiagnosticRunDetail?`. Replace `loadVerificationSummary` with `loadActionCardDetails(storeId, card)` so it clears stale detail before loading. It loads verification summary unchanged; it calls `loadDiagnosticRun` only when `card.diagnosticRunId != null`. In an `OperationsRequestException` detail failure, set `selectedDiagnosticRun = null` and preserve an already loaded verification summary.

- [ ] Run the focused Android command again; expected green.

- [ ] Commit:

```powershell
git add apps/android/app/src/main/java/com/restaurantops/operations/OperationsApi.kt apps/android/app/src/main/java/com/restaurantops/operations/HttpOperationsRepository.kt apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt apps/android/app/src/main/java/com/restaurantops/operations/OperationsViewModel.kt apps/android/app/src/test/java/com/restaurantops/operations/HttpOperationsRepositoryTest.kt apps/android/app/src/test/java/com/restaurantops/operations/OperationsViewModelTest.kt
git commit -m "feat(android): load action evidence details"
```

### Task 4: Render the Selected Frozen Evidence

**Files:** Modify `apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt`; create `apps/android/app/src/test/java/com/restaurantops/operations/OperationsScreenTest.kt`.

- [ ] Write a failing pure helper test for formatting one evidence row without identifiers:

```kotlin
assertEquals("revenue: current 3826000, prior 4400000, change -13.05%", formatDiagnosticEvidence(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05)))
```

- [ ] Run the focused Android command from Task 3; expected red because `formatDiagnosticEvidence` is absent.

- [ ] Pass `viewModel.selectedDiagnosticRun` into `ActionCardsContent`. Render `RecordedDiagnosticEvidenceContent` immediately after the selected linked card. It shows kind, rule version, confidence, and `formatDiagnosticEvidence` output for each public evidence row. It receives no action-card ID and never renders `detail.id`.

- [ ] Add:

```kotlin
internal fun formatDiagnosticEvidence(evidence: DiagnosticEvidence): String =
    "${evidence.metricKey}: current ${evidence.currentValue}, prior ${evidence.priorValue}, change ${evidence.changePercent}%"
```

- [ ] Run the focused Android command; expected green.

- [ ] Commit:

```powershell
git add apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt apps/android/app/src/test/java/com/restaurantops/operations/OperationsScreenTest.kt
git commit -m "feat(android): render recorded action evidence"
```

### Task 5: Full Verification and Delivery

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

- [ ] Verify scope and whitespace before push:

```powershell
rg -n "POS|ERP|delivery|platform|factVersionId|sourceBatchId|sourceCandidateId|objectKey|snapshotKey" apps/android/app/src/main/java/com/restaurantops/operations services/api/src/imports/routes.ts
git diff --check
git status --short
git push origin feature/android-import-api
```
