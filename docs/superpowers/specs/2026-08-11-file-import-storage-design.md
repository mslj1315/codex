# CSV/XLSX File Import Storage Design

## Goal

Let an Android restaurant user select a CSV or XLSX report, upload it through the local API, preserve the original file in MinIO for 90 days, parse it into an independent import batch, and continue through the existing candidate-confirmation flow. Confirmed fact versions remain after raw files expire.

## Scope

This stage delivers real CSV/XLSX selection and upload for Android, API-owned object storage, duplicate-file handling, metadata persistence, and scheduled raw-file cleanup.

It does not add third-party platform synchronization, OCR, background uploads, multi-file automatic merging, raw-file download, manual raw-file deletion, or replacement of uploaded files.

## Product Rules

- A CSV/XLSX file is at most 5 MiB. Existing parser bounds remain authoritative.
- Every uploaded report creates an independent batch, even when another batch has the same store and date range.
- A duplicate is defined by the same SHA-256 checksum in the same store. It returns the existing batch and does not upload, parse, or create facts again.
- Different stores may upload identical files independently.
- Raw objects remain for 90 days from successful upload, then are deleted from MinIO.
- Raw-file deletion never deletes candidates, confirmations, fact versions, provenance, checksum, or audit metadata.
- Only confirmed candidate values are usable by later diagnosis behavior.

## Architecture

Android uses the system document picker and accepts only CSV/XLSX files. It performs a local extension and size precheck, then sends one multipart request to `POST /v1/stores/:storeId/imports/file`.

The API derives enterprise, store, and actor from the existing trusted request context. It calculates a SHA-256 checksum, performs duplicate lookup scoped to the store, applies the existing parser's CSV/XLSX safeguards, writes the raw file to MinIO, and persists the import batch, candidates, and file metadata in PostgreSQL.

The API owns MinIO credentials. Android never receives object storage credentials, a signed object URL, or a production storage endpoint.

Object keys use this stable layout:

```text
imports/{enterpriseId}/{storeId}/{batchId}/{sha256}.{csv|xlsx}
```

## Database Model

Add an import-file record associated one-to-one with a source file batch. It stores:

- enterprise ID, store ID, and batch ID;
- original file name, normalized media type, byte count, and SHA-256 checksum;
- MinIO object key;
- uploaded timestamp, expiry timestamp, and optional cleaned-at timestamp.

The database enforces store-scoped checksum uniqueness for active and historical file records. Retaining the checksum after cleanup makes duplicate behavior deterministic for the full audit lifetime, even though raw bytes are no longer available.

## Request and Transaction Flow

1. Android selects a file through the system picker.
2. Android rejects an unsupported extension or file larger than 5 MiB before upload.
3. API validates request shape and trusted store context, then streams/reads the bounded file while calculating SHA-256.
4. API checks the store-scoped checksum. A match returns the existing batch with an explicit duplicate result.
5. API validates and parses CSV/XLSX using the existing bounded parser.
6. API writes the raw object to MinIO and writes database batch, candidates, and file metadata transactionally.
7. If parsing or object storage fails, no confirmable batch is created. If object storage succeeds but the database transaction fails, API deletes the newly written object before returning failure.
8. Android loads the returned batch into the current ready/unresolved confirmation interface.

The existing manual import endpoint remains unchanged.

## Android Experience

The import source picker keeps CSV, XLSX, and manual options.

For CSV/XLSX:

- Android opens the system document picker, not a broad photo/storage scan.
- The selected file name and size are shown with an `上传并解析` action.
- Upload progress disables repeated submission, source switching, candidate edits, and confirmation.
- A successful new upload enters the current confirmation screen.
- A duplicate result displays `已打开此前导入的报表` and opens the existing batch.
- Network, validation, parser, and trusted-context errors remain actionable while preserving the selected file for retry.
- The existing exact text `待确认，尚未用于诊断` remains unchanged.

Android does not persist a raw report copy outside the system-provided URI used for the active upload.

## Retention Cleanup

The API exposes a controlled cleanup entry point intended for a daily scheduler in local Docker and later Linux deployment. It finds uncleaned records with an expiry at or before the injected current time, deletes the MinIO object, then marks the metadata row as cleaned.

The cleanup operation is idempotent. A missing object is treated as cleaned after the metadata update, and a failed delete leaves the record uncleaned for retry. Cleanup never queries or deletes fact/candidate records.

## Error Handling

- Unsupported file type or local size breach: Android blocks upload locally.
- Server size/parser bound breach: API returns a typed 4xx error; no storage object or batch remains.
- Duplicate checksum: API returns the original batch, not a second batch.
- MinIO unavailable: API returns a neutral storage failure; no batch remains.
- Database failure after object write: API performs compensating object deletion; an object deletion failure is logged for repair and does not claim upload success.
- Expired original file: historical batch remains visible; raw bytes are unavailable and not downloadable in this stage.

## Verification

API coverage will verify CSV and XLSX success, object metadata, store-scoped duplicate behavior, same-period independent batches, parser/object/database failure cleanup, and idempotent 90-day cleanup.

Android coverage will verify document selection constraints, request upload state, duplicate routing, error retention, and navigation into the existing candidate confirmation state.

The final local check uses Docker PostgreSQL, MinIO, and API plus an Android emulator Debug build. It verifies a selected file becomes an object, creates candidates, confirms a fact version, and leaves the fact version intact after a simulated raw-file cleanup.
