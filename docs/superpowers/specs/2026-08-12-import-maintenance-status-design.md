# Import Maintenance Status Design

## Goal

Expose a safe, machine-readable status snapshot for the independent import
maintenance workflow. It lets a scheduler alert on reconciliation backlog and
guard growth without exposing raw file information or adding an HTTP endpoint.

## Selected Approach

Add a read-only maintenance CLI named `import-maintenance-status`. It uses the
same PostgreSQL configuration and a dedicated session advisory lock as other
maintenance commands. It writes exactly one JSON object and exits successfully
when the snapshot is available. Lock contention reports a stable skipped result.

An HTTP endpoint would broaden the application's attack surface and needs an
authorization design. Prometheus is useful later but introduces deployment and
scrape configuration that is disproportionate for this local Compose workflow.

## Snapshot

The JSON object contains only aggregate values:

- `pendingReconciliationJobs`: all jobs in `pending` state.
- `eligibleReconciliationJobs`: pending jobs eligible to run now, including
  retries whose one-hour delay has elapsed.
- `graceDeferredReconciliationJobs`: verify jobs whose five-minute grace period
  has not elapsed.
- `retryDeferredReconciliationJobs`: pending jobs outside grace whose last
  attempt is still inside the one-hour retry delay.
- `failedReconciliationJobs`: pending jobs with at least one failure.
- `oldestEligibleAt`: earliest eligible job creation timestamp as ISO string, or
  null when none exists.
- `reconciliationGuardCount`: number of rows in the guard table.

It deliberately excludes object keys, checksums, batch IDs, enterprise/store
identifiers, filenames, exception messages, credentials, and individual jobs.

## Concurrency And Failure Behavior

The CLI uses lock key `734982138`, distinct from cleanup and reconciliation run
locks. A concurrent status command returns `{ "skipped": true,
"reason": "already_running" }` with exit code 0. All aggregates are queried
inside one read-only transaction, producing a single internally consistent
snapshot. Configuration, connection, query, unlock, or output failures result in
a fixed neutral stderr message and nonzero exit code. Database resources are
always released.

## Deployment

The command is available as `npm run maintenance:status`. Compose adds an
`import-maintenance-status` service under the existing `maintenance` profile,
with no ports and no MinIO configuration because it is database-only. Default
Compose services remain unchanged.

## Verification

Tests cover each aggregate classification, privacy of output shape, one-session
lock ownership/release, contention, configuration failures, transactional query
order, and nonzero error handling. Real isolated PostgreSQL verification inserts
one job in each state and checks that the CLI reports only aggregate values.
