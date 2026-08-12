# Provider Feedback Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, aggregate-only provider-feedback endpoint for customer usage and outcome signals.

**Architecture:** A `src/provider-feedback` read model computes live aggregates from current business tables inside one read-only repeatable-read transaction. Authentication goes through `AuthService` and requires the independent `provider_feedback_viewer` role. The new route neither reuses store APIs nor creates a copy/synchronization table.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL/pg-mem, Vitest.

---

## File Structure

- Create `services/api/src/provider-feedback/repository.ts`: scoped aggregate types and one-snapshot SQL query.
- Create `services/api/src/provider-feedback/service.ts`: strict filter parsing, opaque cursor codec, and page mapping.
- Create `services/api/src/provider-feedback/routes.ts`: bearer/role handling, HTTP mapping, and safe audit event.
- Create `services/api/test/provider-feedback-repository.test.ts`: aggregation, boundary, snapshot, and pagination tests.
- Create `services/api/test/provider-feedback-routes.test.ts`: real auth, privacy, error, and audit tests.
- Modify `services/api/src/auth/repository.ts` and `services/api/src/auth/service.ts`: service-role enforcement.
- Modify `services/api/src/server.ts`: register the route only with production auth.
- Modify `docs/architecture/current-gap-analysis.md`: accurately record the new read model.

### Task 1: Role Authorization Primitive

**Files:**
- Modify: `services/api/src/auth/repository.ts`
- Modify: `services/api/src/auth/service.ts`
- Modify: `services/api/test/auth-service.test.ts`

- [ ] **Step 1: Add a failing isolation test**

Seed three active accounts: an enabled `provider_feedback_viewer`, a
`metric_catalog_operator`, and a disabled feedback viewer. Add this contract:

```ts
await expect(service.requireServiceOperatorRole(viewerToken, "provider_feedback_viewer"))
  .resolves.toEqual({ id: "account_viewer", displayName: "Viewer" });
await expect(service.requireServiceOperatorRole(catalogToken, "provider_feedback_viewer"))
  .rejects.toBeInstanceOf(AuthorizationError);
```

- [ ] **Step 2: Confirm the test is red**

Run from `services/api`:

```text
npm test -- --run test/auth-service.test.ts
```

Expected: `requireServiceOperatorRole` is not defined.

- [ ] **Step 3: Implement the smallest public role boundary**

Export the schema-constrained role union and query only an enabled matching row:

```ts
export type ServiceOperatorRole = "metric_catalog_operator" | "provider_feedback_viewer";

async hasEnabledServiceOperatorRole(accountId: string, role: ServiceOperatorRole): Promise<boolean> {
  const result = await this.database.query(
    "SELECT 1 FROM service_operator_roles WHERE account_id = $1 AND role = $2 AND enabled = true",
    [accountId, role]
  );
  return result.rowCount === 1;
}
```

`AuthService.requireServiceOperatorRole` must call `authenticateAccessToken`
first, return `{ id, displayName }` only when that repository lookup succeeds,
and otherwise throw `AuthorizationError`. It must not infer the role from store
membership.

- [ ] **Step 4: Confirm green state**

Run:

```text
npm test -- --run test/auth-service.test.ts
```

- [ ] **Step 5: Commit**

```text
git add services/api/src/auth/repository.ts services/api/src/auth/service.ts services/api/test/auth-service.test.ts
git commit -m "feat(api): authorize provider feedback viewers"
```

### Task 2: Live Aggregate Repository

**Files:**
- Create: `services/api/src/provider-feedback/repository.ts`
- Create: `services/api/test/provider-feedback-repository.test.ts`

- [ ] **Step 1: Write failing aggregate and transaction tests**

Use the migration loader pattern from `test/auth-routes.test.ts`. Seed active,
stale, inactive, and no-import scopes; raw value, filename, checksum, action
text, execution-note, and diagnostic-evidence sentinels; confirmed fact versions
with both complete and incomplete readiness coverage; diagnostic and action-card
rows across all fixed statuses/outcomes. Assert the active scope equals:

```ts
expect(page.items[0]).toEqual(expect.objectContaining({
  enterpriseId: "ent_active", storeId: "store_active",
  activityState: "active", readinessState: "incomplete", missingMetricCount: 1,
  diagnosticCounts: { revenue_decline: 1 },
  actionCardStatusCounts: { in_progress: 1, verified: 1 },
  verificationOutcomeCounts: { effective: 1 }
}));
```

Assert exactly 30 days is `active`, older is `stale`, and absent import is
`inactive`. Record the client SQL sequence and assert the first statement is
`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`; assert COMMIT/release on
success and ROLLBACK/release on query failure.

- [ ] **Step 2: Confirm red state**

Run:

```text
npm test -- --run test/provider-feedback-repository.test.ts
```

Expected: module does not exist.

- [ ] **Step 3: Implement the public aggregate contract**

Define no raw-row escape hatch:

```ts
export type ActivityState = "active" | "stale" | "inactive";
export type ReadinessState = "ready" | "incomplete" | "unavailable";
export interface ProviderFeedbackRow {
  enterpriseId: string; storeId: string;
  lastSuccessfulImportAt: Date | null; lastConfirmedAt: Date | null;
  activityState: ActivityState; readinessState: ReadinessState; missingMetricCount: number;
  diagnosticCounts: Partial<Record<"revenue_decline", number>>;
  actionCardStatusCounts: Partial<Record<ActionCardStatus, number>>;
  verificationOutcomeCounts: Partial<Record<ActionCardVerificationOutcome, number>>;
  lastCoverageAt: Date | null;
}
```

Implement `list({ now, limit, after, activityState, readinessState })` using a
checked-out client and one CTE query. Union scopes from import batches, fact
versions, diagnostic runs, and action cards. Aggregate max import creation and
fact confirmation. Count covered metric keys only for the latest confirmed fact
version, compare that count with enabled readiness definitions from the one
published catalog, and return only missing count/state. Conditionally count only
`revenue_decline`, the five fixed action statuses, and the four fixed
verification outcomes. Never select values, filenames, checksums, object keys,
candidate IDs, evidence, action fields, or account fields.

Set activity from `now - 30 days`; no successful import is inactive. Set
readiness unavailable without confirmation, ready with zero missing metrics,
else incomplete. Filter with parameters, sort by latest import descending nulls
last then enterprise/store ascending, and fetch `limit + 1`. Use a typed cursor
position to continue equal timestamps and then null timestamps deterministically.
Map only the explicit interface and omit zero-count keys.

- [ ] **Step 4: Confirm green state**

Run:

```text
npm test -- --run test/provider-feedback-repository.test.ts
```

- [ ] **Step 5: Commit**

```text
git add services/api/src/provider-feedback/repository.ts services/api/test/provider-feedback-repository.test.ts
git commit -m "feat(api): aggregate provider feedback"
```

### Task 3: Query Parsing And Pagination

**Files:**
- Create: `services/api/src/provider-feedback/service.ts`
- Modify: `services/api/test/provider-feedback-repository.test.ts`

- [ ] **Step 1: Add failing service tests**

Test default `limit=50`, valid range 1 through 100, both controlled state
filters, identical-timestamp scopes across two pages, and null timestamps after
non-null timestamps. Test invalid values:

```ts
for (const query of [
  { limit: "0" }, { limit: "101" }, { limit: "1.5" },
  { activityState: "all" }, { readinessState: "raw" },
  { cursor: "not-a-base64url-json-cursor" }
]) expect(() => parseProviderFeedbackQuery(query)).toThrow(ValidationError);
```

- [ ] **Step 2: Confirm red state**

Run:

```text
npm test -- --run test/provider-feedback-repository.test.ts
```

Expected: parser/service symbols are absent.

- [ ] **Step 3: Implement service and opaque cursor**

`parseProviderFeedbackQuery` accepts only `limit`, `cursor`, `activityState`,
and `readinessState`; reject arrays and all other representations. Encode this
exact cursor value with base64url JSON:

```ts
{ version: 1, lastSuccessfulImportAt: string | null, enterpriseId: string, storeId: string }
```

Reject extra/missing cursor keys, invalid ISO instants, and blank scope strings.
`ProviderFeedbackService.list` calls the repository with server-owned `now`,
returns only `limit` rows, and emits `nextCursor` from the extra row. Do not
return raw cursors, decoded positions, or an unbounded list.

- [ ] **Step 4: Confirm green state**

Run:

```text
npm test -- --run test/provider-feedback-repository.test.ts
```

- [ ] **Step 5: Commit**

```text
git add services/api/src/provider-feedback/service.ts services/api/test/provider-feedback-repository.test.ts
git commit -m "feat(api): paginate provider feedback"
```

### Task 4: HTTP Route, Audit, And Server Wiring

**Files:**
- Create: `services/api/src/provider-feedback/routes.ts`
- Create: `services/api/test/provider-feedback-routes.test.ts`
- Modify: `services/api/src/server.ts`

- [ ] **Step 1: Add failing integration tests**

Log in actual seeded accounts for a store member, catalog operator, and feedback
viewer. Assert no bearer is 401, catalog role is 403, viewer gets aggregate JSON,
and viewer remains 403 from a store readiness route:

```ts
expect(response.body).not.toMatch(/sentinel-file|sentinel-checksum|987654321|private action|private note|fact_version|accessToken/i);
```

Build Fastify with a capture logger. For 200, 401, 403, and 422, assert one
`provider_feedback_access` event only includes request ID, optional account ID,
fixed role, two boolean filter-presence flags, parsed limit or null, outcome,
and returned count. Assert it excludes bearer, cursor, customer scope, business
sentinels, response rows, and error text. Make the logger throw and prove the
HTTP result does not change.

- [ ] **Step 2: Confirm red state**

Run:

```text
npm test -- --run test/provider-feedback-routes.test.ts
```

Expected: endpoint is unregistered.

- [ ] **Step 3: Implement the isolated route plugin**

Implement `registerProviderFeedbackRoutes(app, { auth, database, now })` and a
local three-part bearer regex. Authorize with:

```ts
await options.auth.requireServiceOperatorRole(accessToken, "provider_feedback_viewer");
```

Only then parse the query and call `ProviderFeedbackService`. Map
`AuthenticationError` to exactly `401 { error: "Authentication required" }`,
`AuthorizationError` to exactly `403 { error: "Provider feedback access is required" }`,
and `ValidationError` to existing 422 JSON. Log once in a best-effort `finally`;
logger exceptions must be swallowed. Register the plugin in `buildServer` only
when `auth` and `database` exist. Development context must never grant this
global role.

- [ ] **Step 4: Confirm focused green state**

Run:

```text
npm test -- --run test/provider-feedback-routes.test.ts test/auth-routes.test.ts test/auth-service.test.ts
```

- [ ] **Step 5: Commit**

```text
git add services/api/src/provider-feedback/routes.ts services/api/src/server.ts services/api/test/provider-feedback-routes.test.ts
git commit -m "feat(api): expose provider feedback projection"
```

### Task 5: State Documentation And Final Verification

**Files:**
- Modify: `docs/architecture/current-gap-analysis.md`

- [ ] **Step 1: Record only the completed capability**

Move the aggregate-only, audited, role-protected feedback read model into
implemented state. Keep the provider web console, catalog UI, customer names,
contacts, exports, detailed dashboards, integrations, and Android provider UI
explicitly deferred.

- [ ] **Step 2: Run final verification**

Run from `services/api`:

```text
npm test -- --run test/provider-feedback-repository.test.ts test/provider-feedback-routes.test.ts test/auth-service.test.ts test/auth-routes.test.ts
npm test
npm run typecheck
npm audit --audit-level=high
```

Run from the repository root:

```text
docker compose config --quiet
docker compose --profile maintenance config --quiet
git diff --check
git status --short
```

Expected: focused and full tests/typecheck pass, audit has no high/critical
finding, both Compose configurations parse, default Compose has no new
maintenance service, and the diff is whitespace-clean.

- [ ] **Step 3: Commit**

```text
git add docs/architecture/current-gap-analysis.md
git commit -m "docs: record provider feedback projection"
```
