# Import Maintenance Scheduling

This project keeps file import storage independent from restaurant-system vendors.
Maintenance commands operate against the local PostgreSQL and MinIO services and
do not expose an HTTP administration endpoint.

## Commands

Run the commands from the repository root. The `maintenance` profile is excluded
from the default API stack, so a scheduled job must opt in explicitly.

```powershell
docker compose --env-file .env.example --profile maintenance run --rm import-cleanup
docker compose --env-file .env.example --profile maintenance run --rm import-reconciliation
docker compose --env-file .env.example --profile maintenance run --rm import-maintenance-status
```

The commands print one JSON result to standard output. Standard error is neutral
and never contains credentials, object keys, file contents, or raw exception text.

## Exit Codes

- `0`: completed successfully, or skipped because another worker owns the advisory lock.
- `1`: configuration, database, storage, unlock, or command failure; cleanup/reconciliation also use `1` when the bounded run reports failures or eligible work remains.

A scheduler should retry exit code `1` with backoff and alert only after the second
consecutive failure to avoid transient Docker or network noise.

## Status Snapshot

`import-maintenance-status` is database-only and reports aggregate values:

```json
{
  "pendingReconciliationJobs": 0,
  "eligibleReconciliationJobs": 0,
  "graceDeferredReconciliationJobs": 0,
  "retryDeferredReconciliationJobs": 0,
  "failedReconciliationJobs": 0,
  "oldestEligibleAt": null,
  "reconciliationGuardCount": 0
}
```

Recommended alert conditions:

- `failedReconciliationJobs > 0` for two consecutive snapshots.
- `eligibleReconciliationJobs > 0` for longer than 15 minutes.
- `oldestEligibleAt` older than 30 minutes while eligible jobs exist.
- `reconciliationGuardCount` grows continuously for 24 hours; guard rows are normally reclaimed by the reconciliation command after their retention window.

`graceDeferredReconciliationJobs` and `retryDeferredReconciliationJobs` are
informational. They are expected immediately after an uncertain write or a failed
attempt and should not page on their own.

## Suggested Schedule

Run reconciliation frequently enough to clear a five-minute grace window, then run
raw-file cleanup less often because objects are retained for 90 days. A practical
starting point is:

```text
every 5 minutes   import-reconciliation
every 15 minutes  import-maintenance-status
every 1 hour      import-cleanup
```

Use one scheduler per environment. Each command has its own PostgreSQL advisory
lock, so accidental overlap skips safely, but a skipped run should still be
recorded by the scheduler for capacity planning.

## Data Safety

The reconciliation runner acquires a per-batch PostgreSQL guard before deciding
whether a persistence-uncertain object may be deleted. It deletes only after a
scoped `NotFoundError`; unknown database state is retained for retry. Cleanup only
deletes objects with `import_files` metadata whose expiry has passed and preserves
batches, candidates, fact versions, and fact values.

Do not invoke `npm run cleanup:imports` or `npm run reconcile:imports` against a
database or MinIO bucket outside the environment named by the Compose project.
