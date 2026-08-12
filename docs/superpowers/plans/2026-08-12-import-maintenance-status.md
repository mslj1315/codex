# Import Maintenance Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a database-only, privacy-safe JSON snapshot of reconciliation and guard maintenance health.

**Architecture:** ImportRepository exposes aggregate counts in a single read-only transaction. A maintenance-only CLI holds a distinct session advisory lock, prints exactly one aggregate JSON record, and does not require MinIO or expose HTTP.

**Tech Stack:** TypeScript, PostgreSQL 16, Vitest, Docker Compose.

---

### Task 1: Add an aggregate status query

**Files:** modify `services/api/src/imports/repository.ts`; create `services/api/test/import-maintenance-status.test.ts`.

- [ ] First write red repository tests that seed pending eligible work, grace-deferred verification work, retry-deferred work, failed work, a resolved job, and guard rows. Assert a result with exactly `pendingReconciliationJobs`, `eligibleReconciliationJobs`, `graceDeferredReconciliationJobs`, `retryDeferredReconciliationJobs`, `failedReconciliationJobs`, `oldestEligibleAt`, and `reconciliationGuardCount`. Assert it contains no job identifiers or object keys.

- [ ] Implement an exported `ImportMaintenanceStatus` type and `getImportMaintenanceStatus(now)`. Validate `now`; use a transaction with `BEGIN READ ONLY`, aggregate `COUNT`/`MIN` queries that classify pending jobs using the existing 5-minute grace and one-hour retry constants, then count guards. Convert all counts to numbers and `oldestEligibleAt` to `Date | null`; commit/rollback/release correctly.

- [ ] Run `npx vitest run test/import-maintenance-status.test.ts` and `npm run typecheck`, then commit `feat(api): add import maintenance status query`.

### Task 2: Add the locked status CLI and Compose profile

**Files:** create `services/api/src/import-maintenance-status.ts`; modify `services/api/package.json`, `docker-compose.yml`, and `services/api/test/import-maintenance-status.test.ts`.

- [ ] Write red CLI tests for required `DATABASE_URL`, lock key `734982138`, same-client lock/unlock/release, contention JSON, one result JSON, fixed stderr, database end, and output shape privacy. Verify MinIO configuration is neither required nor read.

- [ ] Implement injectable `runImportMaintenanceStatus`, using `ImportRepository.getImportMaintenanceStatus(now)`. Return `{ skipped: true, reason: "already_running" }` on lock contention and otherwise the status snapshot. The executable prints `Import maintenance status failed` on errors. Add script `maintenance:status`.

- [ ] Add `import-maintenance-status` to the existing `maintenance` Compose profile with no ports, only `DATABASE_URL`, and command `npm run migrate && npm run maintenance:status`. Verify default Compose has no such service.

- [ ] Run focused tests, complete API tests, typecheck, both Compose configs and diff check. Commit `feat(api): report import maintenance status`.

### Task 3: Verify against isolated PostgreSQL

**Files:** modify only a reproduced production failure.

- [ ] Run the complete completion gate including `npm audit --audit-level=high`.

- [ ] In an isolated PostgreSQL Compose project, apply migrations and insert jobs representing eligible, grace-deferred, retry-deferred, failed, and resolved states plus guards. Run the real CLI, validate all aggregate counts and absence of sensitive fields, then hold advisory lock `734982138` and confirm skipped JSON plus exit code 0. Do not alter the primary stack or commit runtime data.
