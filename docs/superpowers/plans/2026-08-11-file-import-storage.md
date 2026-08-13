# CSV/XLSX File Import Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Android app select a bounded CSV/XLSX report, upload it to the API, preserve the raw file in MinIO for 90 days, reopen duplicate uploads without creating duplicate batches, and clean expired raw objects without deleting confirmed facts.

**Architecture:** Keep the product independent from any restaurant-system vendor. Android uses the system document picker and sends one multipart request to the existing import API. The API remains a modular Fastify application: it parses and hashes the bounded file, stores bytes through an injected object-storage port, commits batch/candidate/file metadata in PostgreSQL, and compensates by deleting the object if the database transaction fails. A controlled maintenance command performs idempotent expiry cleanup.

**Tech Stack:** Kotlin, Jetpack Compose, Activity Result API, Retrofit/OkHttp, TypeScript, Fastify, PostgreSQL 16, MinIO, `minio@8.0.7`, Vitest, JUnit, Docker Compose.

---

## Product And Branch Constraints

- Execute from the existing isolated `android-import-api` worktree after this plan commit; create the implementation branch from that clean point.
- Do not add restaurant-system synchronization, OCR, platform authorization, diagnosis, background uploads, multi-file merging, raw-file download, manual raw-file deletion, or file replacement.
- Keep the existing 5 MiB server and parser limits authoritative.
- Keep the manual import request and response unchanged.
- Keep Release builds free of the local API URL and MinIO credentials.
- Keep the exact unresolved text `待确认，尚未用于诊断`.
- Return `已打开此前导入的报表` only when the server reports a store-scoped checksum duplicate.
- Treat service names below as modules in the existing API process, not new microservices.

## File Structure

**API files to create:**

- `services/api/migrations/002_import_files.sql`: one-to-one file metadata, store-scoped checksum uniqueness, expiry and cleanup audit fields.
- `services/api/src/storage/object-storage.ts`: storage port and typed storage failure.
- `services/api/src/storage/minio-object-storage.ts`: MinIO adapter owned by the API.
- `services/api/src/imports/file-cleanup.ts`: idempotent expired-object cleanup use case.
- `services/api/src/cleanup-import-files.ts`: controlled maintenance command for Docker/Linux scheduling.
- `services/api/test/file-cleanup.test.ts`: cleanup behavior with injected time and fake storage.
- `services/api/test/support/fake-object-storage.ts`: deterministic API/cleanup storage fake.

**API files to modify:**

- `services/api/package.json` and `services/api/package-lock.json`: MinIO SDK and cleanup command.
- `.env.example` and `docker-compose.yml`: bucket configuration and maintenance profile.
- `services/api/src/server.ts`: construct/inject object storage and clock.
- `services/api/src/imports/repository.ts`: file metadata, duplicate lookup, transactional creation and cleanup queries.
- `services/api/src/imports/service.ts`: checksum, duplicate handling, object key, persistence and compensation.
- `services/api/src/imports/routes.ts`: explicit new/duplicate response and neutral storage error.
- `services/api/test/schema.test.ts`, `services/api/test/import-routes.test.ts`, and `services/api/test/migrate.test.ts`: apply both migrations and cover the new invariants.

**Android files to create:**

- `apps/android/app/src/main/java/com/restaurantops/imports/files/ImportFileReader.kt`: bounded ContentResolver reader.
- `apps/android/app/src/main/java/com/restaurantops/imports/files/ImportFileRules.kt`: pure source/extension/size rules.
- `apps/android/app/src/test/java/com/restaurantops/imports/files/ImportFileRulesTest.kt`: local precheck coverage.

**Android files to modify:**

- `apps/android/app/src/main/java/com/restaurantops/imports/ImportModels.kt`: prepared file and upload result models.
- `apps/android/app/src/main/java/com/restaurantops/imports/ImportRepository.kt`: file-import operation.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt`: multipart endpoint and duplicate field.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt`: multipart request mapping.
- `apps/android/app/src/main/java/com/restaurantops/imports/ImportViewModel.kt`: selection, upload, retry and duplicate state.
- `apps/android/app/src/main/java/com/restaurantops/imports/ImportScreens.kt`: system picker, selected-file card and upload action.
- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`: inject the Android file reader.
- `apps/android/app/src/test/java/com/restaurantops/imports/network/HttpImportRepositoryTest.kt` and `apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt`: multipart and state coverage.

---

### Task 1: Persist Import File Metadata And Enforce Duplicate Identity

**Files:**

- Create: `services/api/migrations/002_import_files.sql`
- Modify: `services/api/src/imports/repository.ts`
- Modify: `services/api/test/schema.test.ts`
- Modify: `services/api/test/import-routes.test.ts`

- [ ] **Step 1: Make test setup apply every migration in filename order**

Add this helper to both database-backed test suites, then replace direct reads of `001_imports.sql`:

```ts
async function applyTestMigrations(database: Database): Promise<void> {
  for (const id of ["001_imports.sql", "002_import_files.sql"]) {
    const sql = await readFile(new URL(`../migrations/${id}`, import.meta.url), "utf8");
    await database.query(sql.replace(/\n-- PostgreSQL append-only guards[\s\S]*$/, ""));
  }
}
```

- [ ] **Step 2: Write failing schema tests for one file per batch and store-scoped checksums**

```ts
it("stores one import file per batch and scopes duplicate checksums to a store", async () => {
  const migration = await readFile(new URL("../migrations/002_import_files.sql", import.meta.url), "utf8");
  expect(migration).toContain("UNIQUE (batch_id)");
  expect(migration).toContain("UNIQUE (enterprise_id, store_id, sha256_checksum)");
  expect(migration).toContain("expires_at TIMESTAMPTZ NOT NULL");
  expect(migration).toContain("cleaned_at TIMESTAMPTZ");
});
```

- [ ] **Step 3: Run the focused test and verify the missing migration failure**

Run:

```powershell
Set-Location services/api
npm test -- --run test/schema.test.ts
```

Expected: FAIL because `002_import_files.sql` does not exist.

- [ ] **Step 4: Create the migration**

```sql
CREATE TABLE import_files (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  normalized_mime_type TEXT NOT NULL,
  byte_count BIGINT NOT NULL CHECK (byte_count BETWEEN 1 AND 5242880),
  sha256_checksum TEXT NOT NULL CHECK (length(sha256_checksum) = 64),
  object_key TEXT NOT NULL UNIQUE,
  uploaded_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  cleaned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (batch_id),
  UNIQUE (enterprise_id, store_id, sha256_checksum),
  FOREIGN KEY (batch_id, enterprise_id, store_id)
    REFERENCES import_batches (id, enterprise_id, store_id),
  CHECK (expires_at >= uploaded_at),
  CHECK (cleaned_at IS NULL OR cleaned_at >= uploaded_at)
);

CREATE INDEX import_files_expiry_idx
  ON import_files (expires_at, cleaned_at)
  WHERE cleaned_at IS NULL;
```

- [ ] **Step 5: Add repository types with stable names**

```ts
export interface CreateImportFileInput {
  id: string;
  batchId: string;
  enterpriseId: string;
  storeId: string;
  originalFileName: string;
  normalizedMimeType: string;
  byteCount: number;
  sha256Checksum: string;
  objectKey: string;
  uploadedAt: Date;
  expiresAt: Date;
}

export interface ImportFileRecord extends CreateImportFileInput {
  cleanedAt: Date | null;
}

export class DuplicateImportFileError extends ConflictError {}
```

Add `id?: string` to `CreateBatchInput`, and use `input.id ?? randomUUID()` in `createBatch` so the service can build the object key before persistence.

- [ ] **Step 6: Add duplicate lookup and transactional file insertion**

Implement these methods in `ImportRepository`:

```ts
async findBatchByFileChecksum(scope: {
  enterpriseId: string;
  storeId: string;
  sha256Checksum: string;
}): Promise<ImportBatchDetails | null> {
  const result = await this.database.query<Row>(
    `SELECT batch_id FROM import_files
     WHERE enterprise_id = $1 AND store_id = $2 AND sha256_checksum = $3`,
    [scope.enterpriseId, scope.storeId, scope.sha256Checksum]
  );
  if (result.rowCount !== 1) return null;
  return this.getBatch({ id: String(result.rows[0].batch_id), enterpriseId: scope.enterpriseId, storeId: scope.storeId });
}

async createImportFile(input: CreateImportFileInput): Promise<ImportFileRecord> {
  try {
    const result = await this.database.query<Row>(
      `INSERT INTO import_files (
        id, batch_id, enterprise_id, store_id, original_file_name,
        normalized_mime_type, byte_count, sha256_checksum, object_key,
        uploaded_at, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [input.id, input.batchId, input.enterpriseId, input.storeId, input.originalFileName,
       input.normalizedMimeType, input.byteCount, input.sha256Checksum, input.objectKey,
       input.uploadedAt, input.expiresAt]
    );
    return toImportFile(result.rows[0]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateImportFileError("Import file already exists for store");
    throw error;
  }
}
```

Add the row mapper in the same module so PostgreSQL `BIGINT` values do not leak as strings:

```ts
function toImportFile(row: Row): ImportFileRecord {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    enterpriseId: String(row.enterprise_id),
    storeId: String(row.store_id),
    originalFileName: String(row.original_file_name),
    normalizedMimeType: String(row.normalized_mime_type),
    byteCount: Number(row.byte_count),
    sha256Checksum: String(row.sha256_checksum),
    objectKey: String(row.object_key),
    uploadedAt: new Date(String(row.uploaded_at)),
    expiresAt: new Date(String(row.expires_at)),
    cleanedAt: row.cleaned_at == null ? null : new Date(String(row.cleaned_at))
  };
}
```

Extend `createBatchWithCandidates(input, candidates, file?)` so it calls `createImportFile(file)` inside the same transaction after `createBatch` and before candidate inserts.

- [ ] **Step 7: Verify schema and repository tests pass**

Run:

```powershell
Set-Location services/api
npm test -- --run test/schema.test.ts test/import-routes.test.ts
npm run typecheck
```

Expected: both suites PASS and TypeScript reports no errors.

- [ ] **Step 8: Commit the database boundary**

```powershell
git add services/api/migrations/002_import_files.sql services/api/src/imports/repository.ts services/api/test/schema.test.ts services/api/test/import-routes.test.ts
git commit -m "feat(api): persist import file metadata"
```

---

### Task 2: Add The Object Storage Port And MinIO Adapter

**Files:**

- Create: `services/api/src/storage/object-storage.ts`
- Create: `services/api/src/storage/minio-object-storage.ts`
- Create: `services/api/test/support/fake-object-storage.ts`
- Modify: `services/api/package.json`
- Modify: `services/api/package-lock.json`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `services/api/src/server.ts`

- [ ] **Step 1: Install the pinned MinIO SDK**

Run:

```powershell
Set-Location services/api
npm install --save-exact minio@8.0.7
```

Expected: `package.json` contains `"minio": "8.0.7"` and the lockfile updates without a high or critical audit finding.

- [ ] **Step 2: Define an injectable storage port**

```ts
export interface StoredObjectInput {
  key: string;
  bytes: Buffer;
  contentType: string;
}

export interface ObjectStorage {
  putObject(input: StoredObjectInput): Promise<void>;
  deleteObject(key: string): Promise<"deleted" | "missing">;
}

export class ObjectStorageError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ObjectStorageError";
    this.cause = cause;
  }
}

export const unavailableObjectStorage: ObjectStorage = {
  async putObject(): Promise<void> {
    throw new ObjectStorageError("Unable to store import file");
  },
  async deleteObject(): Promise<"deleted" | "missing"> {
    throw new ObjectStorageError("Unable to delete import file");
  }
};
```

- [ ] **Step 3: Add the deterministic fake used by route and cleanup tests**

```ts
export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, StoredObjectInput>();
  putFailure: Error | null = null;
  deleteFailures = new Set<string>();

  async putObject(input: StoredObjectInput): Promise<void> {
    if (this.putFailure) throw this.putFailure;
    this.objects.set(input.key, { ...input, bytes: Buffer.from(input.bytes) });
  }

  async deleteObject(key: string): Promise<"deleted" | "missing"> {
    if (this.deleteFailures.has(key)) throw new Error("delete failed");
    return this.objects.delete(key) ? "deleted" : "missing";
  }
}
```

- [ ] **Step 4: Implement the MinIO adapter**

```ts
export class MinioObjectStorage implements ObjectStorage {
  private bucketReady: Promise<void> | undefined;

  constructor(private readonly client: Client, private readonly bucket: string) {}

  async putObject(input: StoredObjectInput): Promise<void> {
    await this.ensureBucket();
    try {
      await this.client.putObject(this.bucket, input.key, input.bytes, input.bytes.length, {
        "Content-Type": input.contentType
      });
    } catch (error) {
      throw new ObjectStorageError("Unable to store import file", error);
    }
  }

  async deleteObject(key: string): Promise<"deleted" | "missing"> {
    await this.ensureBucket();
    try {
      await this.client.statObject(this.bucket, key);
    } catch (error) {
      if (isMissingObject(error)) return "missing";
      throw new ObjectStorageError("Unable to inspect import file", error);
    }
    try {
      await this.client.removeObject(this.bucket, key);
      return "deleted";
    } catch (error) {
      throw new ObjectStorageError("Unable to delete import file", error);
    }
  }

  private ensureBucket(): Promise<void> {
    return this.bucketReady ??= (async () => {
      if (!(await this.client.bucketExists(this.bucket))) await this.client.makeBucket(this.bucket);
    })();
  }
}
```

Parse `MINIO_ENDPOINT` with `new URL`, create `Client({ endPoint, port, useSSL, accessKey, secretKey })`, and treat `NoSuchKey`/`NotFound` responses as missing objects.

```ts
function isMissingObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = String((error as { code?: unknown }).code);
  return code === "NoSuchKey" || code === "NotFound" || code === "NoSuchObject";
}
```

- [ ] **Step 5: Wire storage through server options without exposing credentials to Android**

Add to `ServerOptions`:

```ts
objectStorage?: ObjectStorage;
now?: () => Date;
```

Pass `objectStorage` and `now` into `registerImportRoutes`. In the executable server block, construct `MinioObjectStorage` only when all four environment values exist:

```ts
MINIO_ENDPOINT
MINIO_ACCESS_KEY
MINIO_SECRET_KEY
MINIO_BUCKET
```

Use a single options object so future route dependencies cannot be passed in the wrong order:

```ts
export interface ImportRouteOptions {
  database: Database;
  contextResolver: TrustedContextResolver;
  objectStorage: ObjectStorage;
  now: () => Date;
}

registerImportRoutes(instance, {
  database,
  contextResolver,
  objectStorage: options.objectStorage ?? unavailableObjectStorage,
  now: options.now ?? (() => new Date())
});
```

Manual imports remain available when storage configuration is absent. The file endpoint remains registered but returns the neutral typed `503` storage error before parsing or persistence; this keeps the route contract explicit without pretending that a raw file was saved.

- [ ] **Step 6: Update local environment and Compose names**

Add:

```dotenv
MINIO_ACCESS_KEY=localminio
MINIO_SECRET_KEY=local-development-placeholder
MINIO_BUCKET=restaurant-imports
```

Map these API variables from the existing MinIO root values in `docker-compose.yml`. Do not add any MinIO value to Gradle, Android resources, BuildConfig, or an APK manifest.

- [ ] **Step 7: Run API regression and commit**

```powershell
Set-Location services/api
npm test
npm run typecheck
npm audit --audit-level=high
Set-Location ../..
git add .env.example docker-compose.yml services/api/package.json services/api/package-lock.json services/api/src/server.ts services/api/src/storage services/api/test/support
git commit -m "feat(api): add MinIO object storage adapter"
```

Expected: tests and typecheck PASS; audit reports no high or critical vulnerability.

---

### Task 3: Store New Uploads, Reopen Duplicates, And Compensate Failures

**Files:**

- Modify: `services/api/src/imports/service.ts`
- Modify: `services/api/src/imports/routes.ts`
- Modify: `services/api/src/imports/repository.ts`
- Modify: `services/api/test/import-routes.test.ts`

- [ ] **Step 1: Add failing success and duplicate route tests**

```ts
it("stores a new CSV object and returns duplicate false", async () => {
  const response = await uploadCsv("weekly.csv", "订单数\n12\n");
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ duplicate: false, sourceType: "csv" });
  expect(storage.objects.size).toBe(1);
  expect([...storage.objects.keys()][0]).toMatch(
    /^imports\/ent_demo\/store_demo\/[0-9a-f-]+\/[0-9a-f]{64}\.csv$/
  );
});

it("reopens the same store file without parsing or storing it twice", async () => {
  const first = await uploadCsv("weekly.csv", "订单数\n12\n");
  const second = await uploadCsv("renamed.csv", "订单数\n12\n");
  expect(second.statusCode).toBe(200);
  expect(second.json()).toMatchObject({ duplicate: true, id: first.json().id });
  expect(storage.objects.size).toBe(1);
  expect((await pool.query("SELECT * FROM import_batches")).rowCount).toBe(1);
});

it("stores a bounded XLSX object before returning its candidates", async () => {
  const response = await uploadXlsx("weekly.xlsx", await workbookWithOrders(12));
  expect(response.statusCode).toBe(201);
  expect(response.json()).toMatchObject({ duplicate: false, sourceType: "xlsx" });
  expect([...storage.objects.keys()][0]).toMatch(/\.xlsx$/);
});
```

Import `ExcelJS` from `exceljs`, then add these helpers to the route test module:

```ts
function uploadCsv(filename: string, contents: string) {
  return app.inject({
    method: "POST",
    url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
    headers: { "content-type": "text/csv", "x-file-name": filename },
    payload: Buffer.from(contents, "utf8")
  });
}

function uploadXlsx(filename: string, contents: Buffer) {
  return app.inject({
    method: "POST",
    url: "/v1/stores/store_demo/imports/file?rangeStart=2026-08-01&rangeEnd=2026-08-07",
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "x-file-name": filename
    },
    payload: contents
  });
}

async function workbookWithOrders(value: number): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("weekly");
  worksheet.addRow(["订单数"]);
  worksheet.addRow([value]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
```

Build the test app with `buildServer({ database: pool, developmentMode: true, objectStorage: storage, now: () => fixedNow })`.

- [ ] **Step 2: Add failing tests for parse, storage and database failure boundaries**

```ts
it("does not store a parser-rejected file", async () => {
  const response = await uploadCsv("broken.csv", "订单数\nnot-a-number\n");
  expect(response.statusCode).toBe(422);
  expect(storage.objects.size).toBe(0);
  expect((await pool.query("SELECT * FROM import_batches")).rowCount).toBe(0);
});

it("does not create a batch when object storage is unavailable", async () => {
  storage.putFailure = new Error("offline");
  const response = await uploadCsv("weekly.csv", "订单数\n12\n");
  expect(response.statusCode).toBe(503);
  expect(response.json()).toEqual({ error: "Unable to store import file" });
  expect((await pool.query("SELECT * FROM import_batches")).rowCount).toBe(0);
});
```

Add a repository fake that throws after `putObject`; assert the object key is removed and no success response is returned.

- [ ] **Step 3: Run focused tests and verify they fail on placeholder storage**

```powershell
Set-Location services/api
npm test -- --run test/import-routes.test.ts
```

Expected: FAIL because the service still writes `test-placeholder/...` and has no injected storage.

- [ ] **Step 4: Replace placeholder metadata with the real file flow**

Use these stable result types:

```ts
export interface FileImportResult {
  batch: ImportBatchDetails;
  duplicate: boolean;
}

const RAW_FILE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
```

Implement `createFile` in this order:

```ts
const sha256Checksum = createHash("sha256").update(input.bytes).digest("hex");
const duplicate = await this.imports.findBatchByFileChecksum({ ...context, sha256Checksum });
if (duplicate) return { batch: duplicate, duplicate: true };

const sourceType = fileType(input.filename, input.mimeType);
const parsed = sourceType === "csv"
  ? parseCsv(input.bytes.toString("utf8"), input)
  : await parseXlsx(input.bytes, input);
const candidates = parsed.candidates.map((candidate) =>
  this.prepareCandidate(candidate, input.rangeStart, input.rangeEnd)
);
const batchId = randomUUID();
const uploadedAt = this.now();
const expiresAt = new Date(uploadedAt.getTime() + RAW_FILE_RETENTION_MS);
const objectKey = `imports/${context.enterpriseId}/${context.storeId}/${batchId}/${sha256Checksum}.${sourceType}`;

await this.storage.putObject({ key: objectKey, bytes: input.bytes, contentType: normalizedMimeType(sourceType) });
try {
  const batch = await this.imports.createBatchWithCandidates(
    { ...context, id: batchId, sourceType, rangeStart: input.rangeStart, rangeEnd: input.rangeEnd },
    candidates,
    { id: randomUUID(), batchId, enterpriseId: context.enterpriseId, storeId: context.storeId,
      originalFileName: input.filename, normalizedMimeType: normalizedMimeType(sourceType),
      byteCount: input.bytes.length, sha256Checksum, objectKey, uploadedAt, expiresAt }
  );
  return { batch, duplicate: false };
} catch (error) {
  if (error instanceof DuplicateImportFileError) {
    try {
      await this.storage.deleteObject(objectKey);
    } catch (cleanupError) {
      this.logger.error("Failed to delete losing duplicate object", { objectKey, cleanupError });
    }
    const existing = await this.imports.findBatchByFileChecksum({ ...context, sha256Checksum });
    if (existing) return { batch: existing, duplicate: true };
  }
  return compensateObjectWrite(this.storage, objectKey, error, this.logger);
}
```

Use these helpers and inject `logger: Pick<Console, "error"> = console` into `ImportService`:

```ts
function normalizedMimeType(sourceType: "csv" | "xlsx"): string {
  return sourceType === "csv"
    ? "text/csv"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

async function compensateObjectWrite(
  storage: ObjectStorage,
  objectKey: string,
  originalError: unknown,
  logger: Pick<Console, "error">
): Promise<never> {
  try {
    await storage.deleteObject(objectKey);
  } catch (cleanupError) {
    logger.error("Failed to compensate import object write", { objectKey, cleanupError });
  }
  if (originalError instanceof Error) throw originalError;
  throw new Error("Import persistence failed", { cause: originalError });
}
```

For ordinary persistence failures, call `compensateObjectWrite`. For `DuplicateImportFileError`, first attempt deletion of the losing object, log but retain the conflict when deletion fails, then reload the winning batch by checksum and return it as a duplicate. A compensation failure never turns a failed database transaction into upload success.

- [ ] **Step 5: Return an explicit route result**

```ts
const result = await service.createFile(context, input);
return reply
  .code(result.duplicate ? 200 : 201)
  .send({ ...result.batch, duplicate: result.duplicate });
```

Map `ObjectStorageError` to status `503` and `{ error: "Unable to store import file" }`. Preserve the existing 413 and 422 mappings.

- [ ] **Step 6: Verify all API tests and commit**

```powershell
Set-Location services/api
npm test
npm run typecheck
Set-Location ../..
git diff --check
git add services/api/src/imports services/api/test/import-routes.test.ts
git commit -m "feat(api): store uploaded import files"
```

Expected: all API tests PASS, including same-period different-content files creating independent batches and same bytes in different stores remaining independent.

---

### Task 4: Add Idempotent 90-Day Raw-File Cleanup

**Files:**

- Create: `services/api/src/imports/file-cleanup.ts`
- Create: `services/api/src/cleanup-import-files.ts`
- Create: `services/api/test/file-cleanup.test.ts`
- Modify: `services/api/src/imports/repository.ts`
- Modify: `services/api/package.json`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Write failing cleanup tests**

```ts
it("deletes expired objects and preserves batches candidates and facts", async () => {
  const result = await cleanupExpiredImportFiles(imports, storage, new Date("2026-11-10T00:00:00Z"));
  expect(result).toEqual({ scanned: 1, cleaned: 1, failed: 0 });
  expect(storage.objects.size).toBe(0);
  expect((await database.query("SELECT * FROM import_batches")).rowCount).toBe(1);
  expect((await database.query("SELECT * FROM fact_versions")).rowCount).toBe(1);
});

it("treats an already missing object as cleaned", async () => {
  storage.objects.clear();
  const first = await cleanupExpiredImportFiles(imports, storage, expiredAt);
  const second = await cleanupExpiredImportFiles(imports, storage, expiredAt);
  expect(first.cleaned).toBe(1);
  expect(second.scanned).toBe(0);
});

it("keeps checksum identity after cleanup so a duplicate reopens history", async () => {
  await cleanupExpiredImportFiles(imports, storage, expiredAt);
  const existing = await imports.findBatchByFileChecksum({
    enterpriseId: "ent_demo",
    storeId: "store_demo",
    sha256Checksum
  });
  expect(existing?.id).toBe(batchId);
});

it("leaves metadata uncleaned when object deletion fails", async () => {
  storage.deleteFailures.add(objectKey);
  const result = await cleanupExpiredImportFiles(imports, storage, expiredAt);
  expect(result).toEqual({ scanned: 1, cleaned: 0, failed: 1 });
  expect((await database.query("SELECT cleaned_at FROM import_files")).rows[0].cleaned_at).toBeNull();
});
```

- [ ] **Step 2: Add repository cleanup queries**

```ts
async listExpiredImportFiles(now: Date, limit = 100): Promise<ImportFileRecord[]> {
  const result = await this.database.query<Row>(
    `SELECT * FROM import_files
     WHERE cleaned_at IS NULL AND expires_at <= $1
     ORDER BY expires_at, id LIMIT $2`,
    [now, limit]
  );
  return result.rows.map(toImportFile);
}

async markImportFileCleaned(id: string, cleanedAt: Date): Promise<void> {
  await this.database.query(
    `UPDATE import_files SET cleaned_at = COALESCE(cleaned_at, $1), updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [cleanedAt, id]
  );
}
```

- [ ] **Step 3: Implement the cleanup use case**

```ts
export async function cleanupExpiredImportFiles(
  imports: ImportRepository,
  storage: ObjectStorage,
  now: Date,
  limit = 100
): Promise<{ scanned: number; cleaned: number; failed: number }> {
  const files = await imports.listExpiredImportFiles(now, limit);
  let cleaned = 0;
  let failed = 0;
  for (const file of files) {
    try {
      await storage.deleteObject(file.objectKey);
      await imports.markImportFileCleaned(file.id, now);
      cleaned += 1;
    } catch {
      failed += 1;
    }
  }
  return { scanned: files.length, cleaned, failed };
}
```

- [ ] **Step 4: Add the controlled command and Compose maintenance profile**

Add `"cleanup:imports": "tsx src/cleanup-import-files.ts"` to API scripts. The command must require `DATABASE_URL` and all MinIO variables, run one bounded cleanup pass, print its JSON result, close the database, and set a nonzero exit code when `failed > 0`.

Add a non-running-by-default Compose service:

```yaml
  import-cleanup:
    profiles: ["maintenance"]
    build:
      context: ./services/api
    environment:
      DATABASE_URL: ${DATABASE_URL}
      MINIO_ENDPOINT: ${MINIO_ENDPOINT}
      MINIO_ACCESS_KEY: ${MINIO_ROOT_USER}
      MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD}
      MINIO_BUCKET: ${MINIO_BUCKET}
    command: sh -c "npm run migrate && npm run cleanup:imports"
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_started
```

Linux scheduling invokes `docker compose --profile maintenance run --rm import-cleanup`; it does not expose an unauthenticated HTTP cleanup endpoint.

- [ ] **Step 5: Verify cleanup and commit**

```powershell
Set-Location services/api
npm test -- --run test/file-cleanup.test.ts test/schema.test.ts
npm run typecheck
Set-Location ../..
git add docker-compose.yml services/api/package.json services/api/src/cleanup-import-files.ts services/api/src/imports/file-cleanup.ts services/api/src/imports/repository.ts services/api/test/file-cleanup.test.ts
git commit -m "feat(api): clean expired import files"
```

Expected: focused tests PASS; running cleanup twice does not touch facts or reprocess cleaned rows.

---

### Task 5: Add Android Multipart Upload And Local File Rules

**Files:**

- Create: `apps/android/app/src/main/java/com/restaurantops/imports/files/ImportFileRules.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/imports/files/ImportFileReader.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/imports/files/ImportFileRulesTest.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/imports/ImportModels.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/imports/ImportRepository.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt`
- Modify: `apps/android/app/src/test/java/com/restaurantops/imports/network/HttpImportRepositoryTest.kt`

- [ ] **Step 1: Write failing pure-rule tests**

```kotlin
@Test fun `accepts matching csv and xlsx files within five MiB`() {
    assertNull(ImportFileRules.validate("weekly.csv", 5L * 1024 * 1024, ImportSourceType.CSV))
    assertNull(ImportFileRules.validate("weekly.xlsx", 1_024, ImportSourceType.XLSX))
}

@Test fun `rejects mismatched extension unknown size and oversize`() {
    assertEquals("请选择 CSV 文件", ImportFileRules.validate("weekly.xlsx", 100, ImportSourceType.CSV))
    assertEquals("无法读取文件大小", ImportFileRules.validate("weekly.csv", null, ImportSourceType.CSV))
    assertEquals("文件不能超过 5 MiB", ImportFileRules.validate("weekly.csv", 5L * 1024 * 1024 + 1, ImportSourceType.CSV))
}
```

- [ ] **Step 2: Define prepared file and result models**

```kotlin
data class PreparedImportFile(
    val uri: String,
    val displayName: String,
    val mimeType: String,
    val sizeBytes: Long,
    val bytes: ByteArray
)

data class FileImportDraft(
    val rangeStart: String,
    val rangeEnd: String,
    val file: PreparedImportFile
)

data class FileImportResult(
    val summary: ImportSummary,
    val duplicate: Boolean
)
```

Add to `ImportRepository`:

```kotlin
suspend fun createFileImport(storeId: String, draft: FileImportDraft): FileImportResult
```

- [ ] **Step 3: Implement bounded ContentResolver reading**

`ImportFileReader.read(uriString, sourceType)` must run on `Dispatchers.IO`, query `OpenableColumns.DISPLAY_NAME` and `SIZE`, validate before reading, then stream through a counter that throws as soon as the actual bytes exceed the limit. It returns `PreparedImportFile` and does not write a private file copy.

Use this injectable boundary so ViewModel tests do not depend on Android framework stubs:

```kotlin
interface ImportFileReader {
    suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile
}

class AndroidImportFileReader(
    private val contentResolver: ContentResolver,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO
) : ImportFileReader {
    override suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile =
        withContext(ioDispatcher) {
            val parsedUri = Uri.parse(uri)
            val metadata = queryMetadata(parsedUri)
            ImportFileRules.validate(metadata.name, metadata.size, sourceType)?.let {
                throw ImportRequestException(422, it)
            }
            val bytes = requireNotNull(contentResolver.openInputStream(parsedUri)) {
                "无法读取所选文件"
            }.use { input -> input.readBounded(ImportFileRules.MAX_BYTES) }
            PreparedImportFile(uri, metadata.name, metadata.mimeType, bytes.size.toLong(), bytes)
        }
}

private fun InputStream.readBounded(maxBytes: Long): ByteArray {
    val output = ByteArrayOutputStream()
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var total = 0L
    while (true) {
        val count = read(buffer)
        if (count < 0) break
        total += count
        if (total > maxBytes) throw ImportRequestException(422, "文件不能超过 5 MiB")
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
```

`queryMetadata` reads one cursor row and normalizes a missing MIME type from the validated extension. It closes the cursor through `use`.

Keep constants and picker MIME sets on the pure rules object:

```kotlin
object ImportFileRules {
    const val MAX_BYTES = 5L * 1024 * 1024
    private val CSV_MIME_TYPES = arrayOf(
        "text/csv", "text/comma-separated-values", "application/csv", "application/vnd.ms-excel"
    )
    private val XLSX_MIME_TYPES = arrayOf(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    fun mimeTypes(sourceType: ImportSourceType): Array<String> = when (sourceType) {
        ImportSourceType.CSV -> CSV_MIME_TYPES.copyOf()
        ImportSourceType.XLSX -> XLSX_MIME_TYPES.copyOf()
        ImportSourceType.MANUAL -> emptyArray()
    }

    fun validate(name: String, sizeBytes: Long?, sourceType: ImportSourceType): String? {
        val expectedExtension = when (sourceType) {
            ImportSourceType.CSV -> ".csv"
            ImportSourceType.XLSX -> ".xlsx"
            ImportSourceType.MANUAL -> return "手工录入不接受文件"
        }
        if (!name.lowercase().endsWith(expectedExtension)) {
            return if (sourceType == ImportSourceType.CSV) "请选择 CSV 文件" else "请选择 Excel 文件"
        }
        if (sizeBytes == null || sizeBytes < 1) return "无法读取文件大小"
        if (sizeBytes > MAX_BYTES) return "文件不能超过 5 MiB"
        return null
    }
}
```

- [ ] **Step 4: Add the Retrofit multipart contract**

```kotlin
@Multipart
@POST("/v1/stores/{storeId}/imports/file")
suspend fun createFileImport(
    @Path("storeId") storeId: String,
    @Part upload: MultipartBody.Part,
    @Part("rangeStart") rangeStart: RequestBody,
    @Part("rangeEnd") rangeEnd: RequestBody
): ImportBatchResponse
```

Add `val duplicate: Boolean = false` to `ImportBatchResponse` so existing manual responses remain compatible.

- [ ] **Step 5: Map the domain draft to one multipart request**

```kotlin
override suspend fun createFileImport(storeId: String, draft: FileImportDraft): FileImportResult = request {
    val mediaType = draft.file.mimeType.toMediaType()
    val body = draft.file.bytes.toRequestBody(mediaType)
    val part = MultipartBody.Part.createFormData("upload", draft.file.displayName, body)
    val response = api.createFileImport(
        storeId,
        part,
        draft.rangeStart.toRequestBody("text/plain".toMediaType()),
        draft.rangeEnd.toRequestBody("text/plain".toMediaType())
    )
    FileImportResult(response.toSummary(), response.duplicate)
}.also { summaries[ImportKey(storeId, it.summary.id)] = it.summary }
```

The local demo repository must implement the new method by throwing a neutral typed error; it must not pretend that bytes were uploaded.

- [ ] **Step 6: Test multipart mapping and commit**

Extend the fake `ImportApi` in `HttpImportRepositoryTest` to capture the multipart part and fields. Assert the filename, byte content, range, returned summary and duplicate flag.

Run:

```powershell
.\gradlew.bat :apps:android:app:testDebugUnitTest --tests "com.restaurantops.imports.files.ImportFileRulesTest" --tests "com.restaurantops.imports.network.HttpImportRepositoryTest"
git add apps/android/app/src/main/java/com/restaurantops/imports apps/android/app/src/test/java/com/restaurantops/imports
git commit -m "feat(android): add report file upload contract"
```

Expected: focused Android tests PASS.

---

### Task 6: Replace CSV/XLSX Placeholders With The System Picker Workflow

**Files:**

- Modify: `apps/android/app/src/main/java/com/restaurantops/imports/ImportViewModel.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/imports/ImportScreens.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`
- Modify: `apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt`

- [ ] **Step 1: Write failing ViewModel tests for selection, retry and duplicate routing**

```kotlin
@Test fun `file upload opens returned batch and reports a duplicate`() = runTest {
    val repository = FileRepository(FileImportResult(summaryWithReadyAndUnresolved, duplicate = true))
    val viewModel = ImportViewModel(repository, scope = this, fileReader = FakeImportFileReader(preparedCsv))
    viewModel.selectFile("content://weekly", ImportSourceType.CSV)
    advanceUntilIdle()
    viewModel.uploadSelectedFile("store_demo", "2026-08-01", "2026-08-07")
    advanceUntilIdle()
    assertEquals(summaryWithReadyAndUnresolved, viewModel.summary)
    assertEquals("已打开此前导入的报表", viewModel.fileUploadMessage)
}

@Test fun `transport failure preserves selected file for retry`() = runTest {
    val viewModel = ImportViewModel(FailingFileRepository(), scope = this, fileReader = FakeImportFileReader(preparedCsv))
    viewModel.selectFile("content://weekly", ImportSourceType.CSV)
    advanceUntilIdle()
    viewModel.uploadSelectedFile("store_demo", "2026-08-01", "2026-08-07")
    advanceUntilIdle()
    assertEquals(preparedCsv, viewModel.selectedFile)
    assertEquals("连接服务失败，请稍后重试", viewModel.requestError)
}
```

Add deterministic fakes to the same test file:

```kotlin
private class FakeImportFileReader(
    private val prepared: PreparedImportFile
) : ImportFileReader {
    override suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile = prepared
}

private class FileRepository(
    private val result: FileImportResult
) : ImportRepository by FakeImportRepository(result.summary) {
    override suspend fun createFileImport(storeId: String, draft: FileImportDraft): FileImportResult = result
}

private class FailingFileRepository : ImportRepository by FakeImportRepository(summaryWithReadyAndUnresolved) {
    override suspend fun createFileImport(storeId: String, draft: FileImportDraft): FileImportResult =
        throw ImportRequestException(0, "socket closed")
}

private val preparedCsv = PreparedImportFile(
    uri = "content://weekly",
    displayName = "weekly.csv",
    mimeType = "text/csv",
    sizeBytes = 16,
    bytes = "订单数\n12\n".toByteArray()
)
```

Extend every existing `ImportRepository` fake with `createFileImport`; use delegation where possible so compiler failures cannot be hidden by unused fakes.

Also test that a request in flight blocks source switching, repeated upload, editing and confirmation.

- [ ] **Step 2: Add ViewModel state and commands**

Preserve the existing constructor's `scope` position so current tests remain source-compatible:

```kotlin
class ImportViewModel(
    private val repository: ImportRepository,
    private val scope: CoroutineScope? = null,
    private val fileReader: ImportFileReader = UnavailableImportFileReader
) : ViewModel()

private object UnavailableImportFileReader : ImportFileReader {
    override suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile =
        throw ImportRequestException(422, "文件选择尚未启用")
}
```

Add read-only state:

```kotlin
var selectedFile by mutableStateOf<PreparedImportFile?>(null)
    private set
var fileSelectionError by mutableStateOf<String?>(null)
    private set
var fileUploadMessage by mutableStateOf<String?>(null)
    private set
```

`selectFile(uri, source)` prepares the file through the injected reader. `uploadSelectedFile` calls `createFileImport`, applies the returned summary, sets `已打开此前导入的报表` only for duplicates, and preserves `selectedFile` on all failures. A successful new upload clears stale request errors and enters the existing confirmation UI.

- [ ] **Step 3: Add the system document picker**

In `ImportScreen`, use:

```kotlin
val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    uri?.let { viewModel.selectFile(it.toString(), viewModel.selectedSource) }
}
```

CSV and XLSX source cards call `launcher.launch(ImportFileRules.mimeTypes(source))`. Do not request broad storage, photo, camera or media permissions.

- [ ] **Step 4: Replace `LocalFilePlaceholder` with a stable file card**

The card contains two ISO date fields, a choose-file command, selected filename, human-readable size, `上传并解析`, selection error, upload error and duplicate message. Use existing `isLoading`/`canRunCommands` so the layout and controls do not shift or remain active during upload.

Required command state:

```kotlin
val canUpload = viewModel.selectedFile != null &&
    rangeStart.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) &&
    rangeEnd.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) &&
    viewModel.canRunCommands
```

Keep `ImportSummaryContent` unchanged after upload so ready/unresolved candidates use the already-tested confirmation path.

- [ ] **Step 5: Inject the real reader at the workspace boundary**

Use `LocalContext.current.contentResolver` to construct `AndroidImportFileReader`. Keep the existing Debug/Release repository selection: Debug with a nonblank local API uses `HttpImportRepository`; Release uses `LocalDemoImportRepository` and does not receive MinIO credentials or local cleartext exceptions.

- [ ] **Step 6: Run Android regression and commit**

```powershell
.\gradlew.bat :apps:android:app:testDebugUnitTest
.\gradlew.bat :apps:android:app:assembleDebug
.\gradlew.bat :apps:android:app:assembleRelease
git diff --check
git add apps/android/app/src/main/java/com/restaurantops/imports apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/test/java/com/restaurantops/imports
git commit -m "feat(android): select and upload import files"
```

Expected: unit tests, Debug APK and Release APK all build successfully; Release merged manifest contains no cleartext allowance.

---

### Task 7: Verify The Real PostgreSQL, MinIO, API And Android Flow

**Files:**

- Modify only files required by failures proven in this task.

- [ ] **Step 1: Run the complete code regression**

```powershell
Set-Location services/api
npm test
npm run typecheck
npm audit --audit-level=high
Set-Location ../..
.\gradlew.bat :apps:android:app:testDebugUnitTest
.\gradlew.bat :apps:android:app:assembleDebug
.\gradlew.bat :apps:android:app:assembleRelease
git diff --check
```

Expected: all commands exit `0`; npm reports no high or critical vulnerability.

- [ ] **Step 2: Rebuild the local stack and verify migrations**

```powershell
docker compose --env-file .env.example up -d --build postgres minio api
docker compose --env-file .env.example ps
docker compose --env-file .env.example logs api --tail 100
```

Expected: PostgreSQL is healthy, MinIO and API are running, and API logs show `002_import_files.sql` applied once.

- [ ] **Step 3: Exercise a real CSV upload and duplicate**

Use a small UTF-8 CSV fixture and send two multipart requests with the same bytes but different filenames. Expected:

```text
first request: 201, duplicate=false
second request: 200, duplicate=true, same batch id
PostgreSQL: one import_batches row and one import_files row
MinIO: one object under imports/ent_demo/store_demo/<batch>/<sha>.csv
```

- [ ] **Step 4: Confirm facts, run simulated expiry cleanup and verify facts survive**

Confirm the ready candidate through the existing endpoint. Move only the test file's `expires_at` into the past, then run:

```powershell
docker compose --env-file .env.example --profile maintenance run --rm import-cleanup
```

Expected:

```text
MinIO object: deleted
import_files.cleaned_at: populated
import batch and candidates: retained
fact version and values: retained and readable through /v1/stores/store_demo/facts/latest
second cleanup run: scanned=0, cleaned=0, failed=0
```

- [ ] **Step 5: Verify Android on the emulator**

Install the Debug APK, select CSV and XLSX through the system picker, verify selected filename/size, upload, edit an unresolved item, confirm ready values and reopen a duplicate. Check that unsupported/oversize files are blocked locally and a stopped API preserves the selected file for retry.

- [ ] **Step 6: Inspect final branch state and commit any proven fixes**

```powershell
git status --short --branch
git log --oneline --decorate -8
```

Expected: every implementation task has its own commit, no generated APK, `.env`, MinIO data or PostgreSQL data is tracked, and the worktree is clean.
