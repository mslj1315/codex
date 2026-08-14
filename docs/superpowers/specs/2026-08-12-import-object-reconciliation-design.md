# Import Object Reconciliation Design

## Goal

Make the independent file-import flow recover safely when MinIO or PostgreSQL
finishes an operation but the API client receives an uncertain result. The work
must not add restaurant-system integration, a public maintenance API, raw-file
download, or Android behavior changes.

## Context

The import service currently stores an object before committing batch, candidate,
and file metadata in PostgreSQL. It performs an immediate best-effort delete when
an object write or persistence operation reports an error. That is sufficient for
ordinary failures, but cannot distinguish an operation that truly failed from one
whose successful response was lost. A failed delete can also leave an untracked
object behind.

## Considered Approaches

1. Keep synchronous compensation only. This is simple but leaves no durable work
   item when object deletion, a database read, or the original persistence result
   is uncertain.
2. Persist focused reconciliation jobs and run them through a maintenance CLI.
   This preserves the existing synchronous path, makes unresolved cases visible
   and retryable, and needs no distributed transaction manager. This is the
   selected approach.
3. Add a general transactional outbox for every object operation. This offers a
   future asynchronous workflow foundation, but is substantially broader than the
   current single-object import and would delay closing the known failure modes.

## Data Model

Migration `004_import_object_reconciliation.sql` adds
`import_object_reconciliation_jobs`.

Each row has a random ID, enterprise/store scope, the pre-generated batch ID,
object key, SHA-256 checksum, one reconciliation kind, lifecycle timestamps,
attempt information, and sanitized error tokens. The table intentionally has no
foreign key to `import_batches`: jobs must survive when the associated batch never
committed. `object_key` is unique, so the same losing or uncertain object has one
work item regardless of repeated error handling.

Kinds are:

- `delete_orphan`: delete a known private object key. Used when an object write
  response is uncertain or a duplicate-race loser cannot be deleted immediately.
- `verify_batch_then_delete`: wait for a short grace period, load the expected
  scoped batch, retain the object if it committed, and delete only if the batch is
  definitively absent. Used for an uncertain persistence result.

Jobs start as `pending`; terminal rows are `resolved`. Failed attempts increment a
non-negative counter and set `attempted_at`. Queue selection retries only after a
one-hour backoff, with never-attempted jobs first. Verification jobs also have a
five-minute `not_before` grace period before a missing batch can lead to deletion.

## Service Flow

1. The normal success path is unchanged: parse, put the object, commit metadata,
   and return the batch.
2. If `putObject` throws, the service tries to delete the unique object key. A
   deletion failure queues `delete_orphan`, then the original typed storage error
   remains the response.
3. If metadata persistence returns a duplicate conflict, the losing unique object
   key is deleted or queued as `delete_orphan`; the service reloads and returns the
   winner exactly as today.
4. For every other persistence error, the service first tries to read the expected
   batch. A successful read returns it as recovered success. A missing or unreadable
   read queues `verify_batch_then_delete` instead of deleting immediately, then
   returns the original persistence error. Queue insertion failure is logged with
   sanitized tokens and never replaces that original error.

The service never deletes an object merely because a database read was unavailable.
The verifier only deletes after the grace period and an explicit scoped
`NotFoundError`.

## Maintenance Flow

`reconcile-import-objects.ts` requires the same database and MinIO settings as the
existing cleanup CLI. It acquires a distinct PostgreSQL session advisory lock,
processes bounded pages, and writes exactly one JSON result to stdout. A concurrent
run reports `skipped: true` and exits successfully. `failed` or `hasMore` causes a
nonzero process status for scheduler visibility.

For each eligible job:

- `delete_orphan` calls idempotent `deleteObject`; both `deleted` and `missing`
  resolve the job.
- `verify_batch_then_delete` loads the scoped expected batch. Existing means
  `persistence_committed` and resolves without deletion. `NotFoundError` triggers
  idempotent object deletion and then resolves. Any other database or storage
  failure records a retry attempt without deleting.

The CLI is added as a maintenance-only Compose service. It has no port and no HTTP
route.

## Privacy And Observability

Jobs store only IDs, encoded object keys, checksums, stable kind/state values, and
whitelisted error type/code tokens. They never store raw file bytes, file contents,
MinIO credentials, URL query strings, or arbitrary exception messages. JSON output
reports scanned, resolved, failed, deferred, passes, and hasMore so scheduled runs
are monitorable.

## Verification

Tests will use a deterministic object-storage fake and repository seams to prove:

- a post-store object-write timeout queues and later removes an orphan;
- an uncertain database result retains an object until the grace period, then
  retains it when the batch exists or removes it when the batch is absent;
- unknown database reads never trigger deletion;
- duplicate-race cleanup failures enqueue only the losing object key;
- retries, ordering, lock ownership, and CLI exit codes are deterministic;
- no raw error message or secret is stored or printed.

The completion gate is the full API regression, typecheck, high-severity audit
threshold, Compose validation, real PostgreSQL/MinIO verification, and diff check.
