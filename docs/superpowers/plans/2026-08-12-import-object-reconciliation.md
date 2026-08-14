# Import Object Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and safely reconcile uncertain MinIO/PostgreSQL import outcomes without deleting a possibly committed raw file.

**Architecture:** PostgreSQL holds one durable job per object key. ImportService retains its synchronous response but creates a job whenever compensation cannot safely prove deletion. A maintenance-only CLI takes an advisory lock and retries bounded pages; it deletes known losing keys and verifies the scoped batch before deleting a persistence-uncertain key.

**Tech Stack:** TypeScript, PostgreSQL 16, MinIO, Vitest, Docker Compose.

---

### Task 1: Persist reconciliation jobs

**Files:** create `services/api/migrations/004_import_object_reconciliation.sql`; modify `services/api/src/imports/repository.ts` and `services/api/test/schema.test.ts`.

- [ ] Write a red migration test that asserts a job table, unique `object_key`, pending/resolved lifecycle, retry fields, `not_before`, and a partial pending index. Run `npx vitest run test/schema.test.ts`; it must fail because migration 004 does not exist.

- [ ] Add this migration:

```sql
CREATE TABLE import_object_reconciliation_jobs (
  id TEXT PRIMARY KEY,
  enterprise_id TEXT NOT NULL, store_id TEXT NOT NULL, batch_id TEXT NOT NULL,
  sha256_checksum TEXT NOT NULL CHECK (length(sha256_checksum) = 64),
  object_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('delete_orphan', 'verify_batch_then_delete')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'resolved')),
  not_before TIMESTAMPTZ NOT NULL, attempted_at TIMESTAMPTZ,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  resolved_at TIMESTAMPTZ, resolution TEXT CHECK (resolution IN ('object_removed', 'persistence_committed')),
  last_error_type TEXT, last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX import_object_reconciliation_queue_idx
  ON import_object_reconciliation_jobs (not_before, attempted_at, created_at, id)
  WHERE state = 'pending';
```

- [ ] Add `CreateImportObjectReconciliationJob` and `ImportObjectReconciliationJob` types. Implement enqueue by unique key, eligible listing with one-hour retry backoff, pending-only resolution, and failure bookkeeping that stores only validated error type/code. Write red then green tests for duplicate enqueue, order, retry, and idempotent resolution. Run `npx vitest run test/schema.test.ts` and `npm run typecheck`; commit `feat(api): persist import object reconciliation jobs`.

### Task 2: Add the reconciliation runner

**Files:** create `services/api/src/imports/object-reconciliation.ts` and `services/api/test/object-reconciliation.test.ts`.

- [ ] First write red tests for four exact outcomes: `delete_orphan` resolves after either `deleted` or `missing`; an existing expected batch resolves as `persistence_committed` without deletion; only `NotFoundError` permits `verify_batch_then_delete` deletion; every other database/storage error records one retry and does not delete.

- [ ] Implement `reconcileImportObjects(repository, storage, now, limit)` and `runImportObjectReconciliation(repository, storage, now, options)`. Defaults are page size 100 and 10 passes; valid page size is 1..1000 and pass count is 1..100. The runner returns `scanned`, `resolved`, `failed`, `deferred`, `passes`, and `hasMore`. `hasMore` means an extra eligible pending job exists, never merely a grace-delayed job. Run focused tests and typecheck; commit `feat(api): reconcile uncertain import objects`.

### Task 3: Enqueue uncertain outcomes from ImportService

**Files:** modify `services/api/src/imports/service.ts`, `services/api/test/file-import-service.test.ts`, and `services/api/test/file-import-route-failure.test.ts`.

- [ ] First add failing service tests: stored-then-thrown `putObject` plus failed deletion queues `delete_orphan`; a duplicate-race losing object with failed deletion queues `delete_orphan`; a persistence error with missing or unknown batch lookup queues `verify_batch_then_delete` for `now + 5 minutes`. Every test asserts the original operational error remains unchanged.

- [ ] Change the deletion helper to report normal completion. Add a private enqueue helper using a random job ID and sanitized diagnostics; enqueue failures are logged and never mask the original result. Preserve current successful batch recovery. For missing or unknown persistence lookup, enqueue verification rather than delete immediately. Run focused tests, then `npm test` and `npm run typecheck`; commit `fix(api): queue uncertain import outcomes`.

### Task 4: Add a locked maintenance command

**Files:** create `services/api/src/reconcile-import-objects.ts` and `services/api/test/reconcile-import-objects.test.ts`; modify `services/api/package.json` and `docker-compose.yml`.

- [ ] Write red CLI tests modeled on cleanup: require database plus four MinIO values, hold advisory lock `734982137` on the same client, output `{"skipped":true,"reason":"already_running"}` for contention, always unlock/release/end, and exit nonzero for failed work or an eligible backlog.

- [ ] Implement injectable CLI `runImportObjectReconciliationCli`, fixed executable stderr `Import object reconciliation failed`, and one JSON stdout result. Add script `reconcile:imports`. Add maintenance-only `import-reconciliation` Compose service with no port and command `npm run migrate && npm run reconcile:imports`. Run its tests, default and maintenance Compose config, plus diff check; commit `feat(api): reconcile import objects from maintenance CLI`.

### Task 5: Verify recovery against real services

**Files:** modify only files required by a reproduced failure.

- [ ] Run `npm test`, `npm run typecheck`, `npm audit --audit-level=high`, both Compose config checks, and diff check.

- [ ] In isolated PostgreSQL/MinIO, verify three jobs: known orphan becomes `object_removed`; existing batch becomes `persistence_committed` without object deletion; absent batch after grace deletes the object. Hold advisory lock `734982137` to verify a skipped, successful CLI run. Inspect migration records and ensure no runtime data is staged. Commit only a focused, regression-tested integration correction.
