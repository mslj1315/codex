# Diagnostic Evidence Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Persist auditable evidence records for actionable deterministic revenue-decline diagnoses and link action cards created from them.

**Architecture:** Migration 008 introduces immutable diagnostic-run/evidence tables and a nullable, scoped action-card reference. The repository calculates from confirmed fact values including fact-version IDs, persists-or-reuses a canonical SHA-256 snapshot transactionally, and returns public evidence only. Existing manual action cards retain a null diagnostic reference. Android maps and displays public evidence fields only.

**Tech Stack:** PostgreSQL, TypeScript, Fastify, Node crypto SHA-256, Vitest/pg-mem, Kotlin, Retrofit, Compose, JUnit 4.

---

## File Map

- `services/api/migrations/008_diagnostic_evidence.sql`: immutable tables, composite isolation, snapshot uniqueness, action-card reference.
- `services/api/src/imports/repository.ts`: diagnostic run/evidence types, fact-version-aware rule query, transactional snapshot persistence/read, action-card linkage.
- `services/api/src/imports/service.ts`: service-level persisted diagnostic and linked card creation.
- `services/api/src/imports/routes.ts`: public diagnostic-run endpoint only if needed by Android evidence detail.
- `services/api/test/schema.test.ts`: migration schema constraints.
- `services/api/test/data-readiness.test.ts`: persistence, idempotency, no-diagnosis, isolation, privacy tests.
- `services/api/test/action-cards.test.ts`: linked vs manual action-card behavior.
- `services/api/test/import-routes.test.ts`: public endpoint shape and create-from-diagnostic linkage.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsApi.kt`: public evidence DTO fields.
- `apps/android/app/src/main/java/com/restaurantops/operations/HttpOperationsRepository.kt`: evidence mapping and nullable run ID.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt`: evidence and provenance display.
- `apps/android/app/src/test/java/com/restaurantops/operations/HttpOperationsRepositoryTest.kt`: DTO privacy/mapping tests.

### Task 1: Add Immutable Diagnostic Schema

**Files:** Create `services/api/migrations/008_diagnostic_evidence.sql`; modify `services/api/test/schema.test.ts`.

- [ ] Write a failing migration assertion for `diagnostic_runs.snapshot_key` uniqueness, `diagnostic_evidence` cascade ownership, and `action_cards.diagnostic_run_id` nullable composite reference.

```ts
await expect(database.query(
  "INSERT INTO diagnostic_runs (id, enterprise_id, store_id, kind, range_start, range_end, prior_range_start, prior_range_end, rule_version, confidence, snapshot_key) VALUES ('r2','ent','store','revenue_decline','2026-08-01','2026-08-07','2026-07-25','2026-07-31','revenue_decline_v1','high','same')"
)).rejects.toThrow();
```

- [ ] Run `npm test -- schema.test.ts` in `services/api`; expected red because migration 008 is absent.

- [ ] Create tables with immutable application ownership:

```sql
CREATE TABLE diagnostic_runs (
  id TEXT PRIMARY KEY, enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'revenue_decline'),
  range_start DATE NOT NULL, range_end DATE NOT NULL,
  prior_range_start DATE NOT NULL, prior_range_end DATE NOT NULL,
  rule_version TEXT NOT NULL, confidence TEXT NOT NULL CHECK (confidence IN ('high','medium')),
  snapshot_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, enterprise_id, store_id),
  UNIQUE (enterprise_id, store_id, snapshot_key),
  CHECK (range_start <= range_end), CHECK (prior_range_start <= prior_range_end)
);
CREATE TABLE diagnostic_evidence (
  id TEXT PRIMARY KEY, diagnostic_run_id TEXT NOT NULL, enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL,
  metric_key TEXT NOT NULL CHECK (metric_key = 'revenue'),
  current_value BIGINT NOT NULL, prior_value BIGINT NOT NULL,
  change_percent NUMERIC NOT NULL, current_fact_version_id TEXT NOT NULL, prior_fact_version_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostic_run_id, enterprise_id, store_id) REFERENCES diagnostic_runs (id, enterprise_id, store_id) ON DELETE CASCADE,
  UNIQUE (diagnostic_run_id, metric_key)
);
ALTER TABLE action_cards ADD COLUMN diagnostic_run_id TEXT;
ALTER TABLE action_cards ADD CONSTRAINT action_cards_diagnostic_run_scope_fk
  FOREIGN KEY (diagnostic_run_id, enterprise_id, store_id) REFERENCES diagnostic_runs (id, enterprise_id, store_id);
```

- [ ] Re-run the schema test green and commit `feat(api): add diagnostic evidence schema`.

### Task 2: Persist and Reuse Deterministic Evidence Snapshots

**Files:** Modify `repository.ts`; modify `data-readiness.test.ts`.

- [ ] Write failing tests that seed current/prior revenue fact values with distinct fact-version IDs, call `getDeterministicDiagnostic` twice, and assert one run/evidence row plus equal `diagnosticRunId`. Update one fact-version/value and assert a new run. Assert stable/improving and missing data create zero runs.

- [ ] Run `npm test -- data-readiness.test.ts`; expected red because diagnostic output lacks run ID and persistence.

- [ ] Extend public types:

```ts
interface DiagnosticEvidence {
  metricKey: 'revenue'; currentValue: number; priorValue: number; changePercent: number;
}
interface DeterministicDiagnostic {
  diagnosticRunId: string; ruleVersion: 'revenue_decline_v1'; evidence: DiagnosticEvidence[];
}
```

Change the rule query to select `value, fact_version_id`. Build canonical JSON from scope, periods, rule version, confidence, values, and fact-version IDs; SHA-256 it. In one transaction: insert the run/evidence with `ON CONFLICT (enterprise_id, store_id, snapshot_key) DO NOTHING`; select the scoped run and evidence; return only public numeric evidence. Do not include batch IDs, candidate IDs, object keys, source locators, or fact-version IDs in API output.

- [ ] Re-run the focused test green and commit `feat(api): persist diagnostic evidence snapshots`.

### Task 3: Link Cards Created From Diagnostics

**Files:** Modify `repository.ts`, `service.ts`; modify `action-cards.test.ts`, `import-routes.test.ts`.

- [ ] Write failing tests that create a diagnostic-derived action card and assert its `diagnosticRunId` equals the response diagnostic run; create a manual card and assert null; attempt cross-store run reference and assert rejection.

- [ ] Run `npm test -- action-cards.test.ts import-routes.test.ts`; expected red because card input/output has no diagnostic run field.

- [ ] Extend `CreateActionCardInput` and `ActionCard` with nullable `diagnosticRunId`. `createActionCardFromDiagnostic` must call persisted diagnostic retrieval and pass its non-null ID. Repository INSERT includes `diagnostic_run_id`; manual input leaves it null. Map it from returned rows. The Fastify response includes only the opaque run ID, never evidence source IDs.

- [ ] Re-run focused API tests green and commit `feat(api): link actions to diagnostic evidence`.

### Task 4: Map and Render Public Evidence on Android

**Files:** Modify `OperationsApi.kt`, `HttpOperationsRepository.kt`, `OperationsScreen.kt`; modify `HttpOperationsRepositoryTest.kt`.

- [ ] Write failing Android repository tests asserting a diagnostic response with `diagnosticRunId`, `ruleVersion`, and public evidence maps correctly, while reflection confirms DTO fields exclude `factVersionId`, `sourceBatchId`, `sourceCandidateId`, and `objectKey`.

- [ ] Run `:apps:android:app:testDebugUnitTest --tests com.restaurantops.operations.HttpOperationsRepositoryTest`; expected red because DTO/domain mapping lacks evidence fields.

- [ ] Add public Kotlin fields:

```kotlin
data class DiagnosticEvidence(val metricKey: String, val currentValue: Long, val priorValue: Long, val changePercent: Double)
data class DeterministicDiagnostic(
  val kind: String, val confidence: OperationsConfidence, val diagnosticRunId: String,
  val ruleVersion: String, val evidence: List<DiagnosticEvidence>
)
```

Map the server DTO exactly. Render rule version plus current/prior/percent evidence below the diagnostic conclusion; cards with non-null `diagnosticRunId` show a concise recorded-evidence origin. Do not show raw run input IDs, import IDs, fact-version IDs, batch IDs, or file/object information.

- [ ] Run the focused Android repository test green and commit `feat(android): show diagnostic evidence`.

### Task 5: Final Verification and Delivery

**Files:** Modify only code required by verified defects.

- [ ] Run API verification in `services/api`:

```powershell
npm test
npm run typecheck
npm audit --audit-level=high
```

- [ ] Run Android verification from repository root:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' ':apps:android:app:assembleDebug' ':apps:android:app:assembleRelease' '--no-daemon' '--console=plain'
git diff --check
```

- [ ] Inspect scope with `rg -n "POS|ERP|delivery|platform|object_key|source_batch_id|source_candidate_id" services/api/src apps/android/app/src/main/java/com/restaurantops/operations`; expected no external integration and no source identifiers in public Android models. Push with `git push origin feature/android-import-api`.
