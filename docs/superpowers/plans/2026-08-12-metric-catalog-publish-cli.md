# Metric Catalog Publish CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a service-provider-only CLI that publishes a new versioned metric catalog from a JSON manifest.

**Architecture:** The CLI parses a local JSON array before opening the database, creates a draft through the existing operator service, upserts each manifest definition, and publishes the draft. It writes one privacy-safe JSON result and uses a fixed stderr message for all executable failures. The existing store HTTP server remains read-only.

**Tech Stack:** Node.js, TypeScript, `tsx`, PostgreSQL repository interfaces, Vitest, pg-mem.

---

### Task 1: Establish CLI contract tests

**Files:**
- Create: `services/api/test/publish-metric-catalog.test.ts`
- Create: `services/api/src/publish-metric-catalog.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("publishes a manifest through a draft and writes one public result", async () => {
  const result = await runPublishMetricCatalog({ DATABASE_URL: "postgres://test", METRIC_CATALOG_FILE: manifestPath }, dependencies);
  expect(result).toEqual({ versionNumber: 2, state: "published" });
  expect(output).toEqual([JSON.stringify(result)]);
});

it("rejects missing database url and malformed manifests before opening the database", async () => {
  await expect(runPublishMetricCatalog({}, dependencies)).rejects.toThrow("DATABASE_URL is required");
  expect(createDatabase).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- publish-metric-catalog.test.ts`

Expected: FAIL because `publish-metric-catalog.ts` and `runPublishMetricCatalog` do not exist.

- [ ] **Step 3: Implement the minimal CLI**

```ts
export async function runPublishMetricCatalog(environment = process.env, dependencies = defaultDependencies) {
  const databaseUrl = required(environment.DATABASE_URL, "DATABASE_URL is required");
  const manifest = dependencies.readManifest(required(environment.METRIC_CATALOG_FILE, "METRIC_CATALOG_FILE is required"));
  const database = dependencies.createDatabase(databaseUrl);
  try {
    const operator = new MetricCatalogOperatorService(new MetricCatalogRepository(database));
    const draft = await operator.createDraftFromPublished();
    for (const definition of manifest) await operator.upsertDraftDefinition(draft.id, definition);
    await operator.publishDraft(draft.id);
    const result = { versionNumber: draft.versionNumber, state: "published" as const };
    dependencies.writeOutput(JSON.stringify(result));
    return result;
  } finally { await database.end(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- publish-metric-catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add services/api/src/publish-metric-catalog.ts services/api/test/publish-metric-catalog.test.ts
git commit -m "feat(api): publish metric catalogs from cli"
```

### Task 2: Wire the guarded executable and package script

**Files:**
- Modify: `services/api/src/publish-metric-catalog.ts`
- Modify: `services/api/package.json`
- Test: `services/api/test/publish-metric-catalog.test.ts`

- [ ] **Step 1: Write the failing executable tests**

```ts
it("keeps executable failures neutral and leaves no raw manifest or database error in stderr", async () => {
  await expect(runPublishMetricCatalog(validEnvironment, failingDependencies)).rejects.toThrow();
  expect(stderr).toBe("Metric catalog publish failed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- publish-metric-catalog.test.ts`

Expected: FAIL until the executable guard emits the fixed message.

- [ ] **Step 3: Add executable guard and package script**

```ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await runPublishMetricCatalog(); }
  catch { console.error("Metric catalog publish failed"); process.exitCode = 1; }
}
```

```json
"publish:metric-catalog": "tsx src/publish-metric-catalog.ts"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- publish-metric-catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add services/api/src/publish-metric-catalog.ts services/api/package.json services/api/test/publish-metric-catalog.test.ts
git commit -m "feat(api): add metric catalog publish command"
```

### Task 3: Full verification

**Files:**
- Verify only

- [ ] **Step 1: Run API test and type checks**

Run: `npm test` and `npm run typecheck` from `services/api`.

Expected: all tests and the TypeScript check pass.

- [ ] **Step 2: Verify no store route or unrelated changes**

Run: `git diff --check` and inspect `git diff --stat origin/feature/android-import-api...HEAD`.

Expected: no whitespace errors; changes are limited to the CLI, package script, tests, and approved documentation.
