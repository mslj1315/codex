# Provider Customer Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable provider-owned customer aliases and internal notes to the existing provider console without changing the aggregate feedback, Android, or store API contracts.

**Architecture:** A new `provider-customers` module composes the existing read-only feedback page with a separate versioned metadata repository. Reads continue to require `provider_feedback_viewer`; writes require that role plus the new `provider_customer_metadata_editor` role, validate that the scope already exists in feedback sources, and use optimistic version checks. The console calls only two exact same-origin route families and renders metadata as plain text.

**Tech Stack:** TypeScript, Fastify 5, PostgreSQL/pg-mem, Vitest, React 19, Vite, Testing Library, Android/Gradle regression checks.

---

## File Structure

- Create `services/api/migrations/012_provider_customer_metadata.sql`: extend the constrained service-role enum and create the versioned metadata table.
- Modify `services/api/src/auth/repository.ts`: add the editor role to the shared role union.
- Modify `services/api/src/auth/service.ts`: expose the browser capability and require multiple roles after one authentication.
- Modify `services/api/src/provision-account.ts`: accept the new role through the existing controlled CLI.
- Create `services/api/src/grant-service-role.ts`: grant one provider role to an existing account without changing credentials, memberships, or sessions.
- Modify `services/api/package.json`: expose the narrow role-grant command.
- Create `services/api/src/provider-customers/repository.ts`: scope existence, batched reads, create/replace/clear, and conflict results.
- Create `services/api/src/provider-customers/service.ts`: exact request validation, Unicode-aware normalization, list composition, and public response mapping.
- Create `services/api/src/provider-customers/routes.ts`: list/write HTTP mapping and content-free auditing.
- Modify `services/api/src/server.ts`: register the new routes only in the database-backed production-auth path.
- Create `services/api/test/provider-customer-metadata-repository.test.ts`: schema, normalization, version, scope, and query-count contracts.
- Create `services/api/test/provider-customer-routes.test.ts`: authorization, HTTP, compatibility, privacy, and audit contracts.
- Create `services/api/test/grant-service-role.test.ts`: role-grant input, output, and side-effect boundaries.
- Modify `services/api/test/auth-service.test.ts`, `provider-browser-auth-routes.test.ts`, and `provision-account.test.ts`: role and capability regression coverage.
- Modify `apps/provider-console/src/api.ts` and `session.test.ts`: allow only the exact composed-list GET and versioned metadata PUT routes.
- Modify `apps/provider-console/src/session.ts`: model the new server-issued capability.
- Modify `apps/provider-console/src/feedback.ts`: map the nested composed response and expose metadata mutation helpers.
- Create `apps/provider-console/src/provider-customer-editor.tsx`: isolated alias/note draft, save, clear, conflict, and retry behavior.
- Modify `apps/provider-console/src/feedback-workbench.tsx`, `feedback-workbench.test.tsx`, `app.tsx`, `app.test.tsx`, and `styles.css`: show and edit customer metadata without exposing new data classes.
- Modify `docs/operations/self-hosted-identity.md`: document controlled assignment of the editor role.
- Modify `docs/architecture/current-gap-analysis.md`: record the already-built console and the completed metadata capability without unrelated rewriting.

### Task 1: Schema And Independent Editor Role

**Files:**
- Create: `services/api/migrations/012_provider_customer_metadata.sql`
- Modify: `services/api/src/auth/repository.ts`
- Modify: `services/api/src/provision-account.ts`
- Create: `services/api/src/grant-service-role.ts`
- Modify: `services/api/package.json`
- Test: `services/api/test/schema.test.ts`
- Test: `services/api/test/provision-account.test.ts`
- Create: `services/api/test/grant-service-role.test.ts`

- [ ] **Step 1: Write failing migration and provisioning tests**

In `schema.test.ts`, after applying all migrations, assert the new role and table constraints with real inserts:

```ts
await database.query(
  "INSERT INTO service_operator_roles (account_id, role) VALUES ('account_owner', 'provider_customer_metadata_editor')"
);
await database.query(`INSERT INTO provider_customer_metadata
  (enterprise_id, store_id, customer_alias, provider_note, version, updated_by_account_id)
  VALUES ('ent_demo', 'store_demo', 'Pilot', 'Internal note', 1, 'account_owner')`);
await expect(database.query(`INSERT INTO provider_customer_metadata
  (enterprise_id, store_id, customer_alias, version, updated_by_account_id)
  VALUES ('ent_demo', 'store_demo', 'Duplicate', 1, 'account_owner')`)).rejects.toThrow();
await expect(database.query(`INSERT INTO provider_customer_metadata
  (enterprise_id, store_id, customer_alias, version, updated_by_account_id)
  VALUES ('ent_other', 'store_other', 'Invalid', 0, 'account_owner')`)).rejects.toThrow();
```

In `provision-account.test.ts`, add a table-driven assertion that
`PROVISION_SERVICE_OPERATOR_ROLE=provider_customer_metadata_editor` reaches the
provisioner unchanged, while an arbitrary role is rejected before database
creation.

In `grant-service-role.test.ts`, inject a fake database/repository and assert:

```ts
await expect(runGrantServiceRole({
  DATABASE_URL: "postgresql://database",
  GRANT_ACCOUNT_ID: "account_editor",
  GRANT_SERVICE_OPERATOR_ROLE: "provider_customer_metadata_editor"
}, dependencies)).resolves.toEqual({
  accountId: "account_editor",
  role: "provider_customer_metadata_editor",
  roleGranted: true
});
expect(events).toEqual(["database", "grant", "output", "end"]);
```

Assert an invalid account identifier or role fails before opening the database,
repository failure still closes the database, output never contains database
credentials, and `package.json` exposes
`"grant:service-role": "tsx src/grant-service-role.ts"`.

In `auth-service.test.ts`, create a normal logged-in account with one store
membership, call `AuthRepository.grantServiceOperatorRole`, and assert the
existing access token still authenticates, the membership row is unchanged,
the password hash is unchanged, and only the requested service-role row is
enabled. Also assert a missing or disabled account returns `false` without
creating a role row.

- [ ] **Step 2: Run the focused tests and confirm red state**

Run from `services/api`:

```text
npm test -- --run test/schema.test.ts test/provision-account.test.ts test/grant-service-role.test.ts
```

Expected: FAIL because migration 012, the new role literal, and the narrow grant
command do not exist.

- [ ] **Step 3: Add migration 012**

Create this migration, using the current PostgreSQL-generated check name from
`011_identity.sql`:

```sql
ALTER TABLE service_operator_roles
  DROP CONSTRAINT service_operator_roles_role_check;

ALTER TABLE service_operator_roles
  ADD CONSTRAINT service_operator_roles_role_check
  CHECK (role IN (
    'metric_catalog_operator',
    'provider_feedback_viewer',
    'provider_customer_metadata_editor'
  ));

CREATE TABLE provider_customer_metadata (
  enterprise_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_alias TEXT,
  provider_note TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by_account_id TEXT NOT NULL REFERENCES accounts (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (enterprise_id, store_id),
  CHECK (customer_alias IS NULL OR length(customer_alias) BETWEEN 1 AND 120),
  CHECK (provider_note IS NULL OR length(provider_note) BETWEEN 1 AND 2000),
  CHECK (customer_alias IS NOT NULL OR provider_note IS NOT NULL)
);
```

Application validation handles control characters and normalization; database
checks enforce non-empty persisted content, code-point lengths, and positive
versions.

- [ ] **Step 4: Extend the shared role types and CLI parser**

In `auth/repository.ts`, make the single source of truth:

```ts
export type ServiceOperatorRole =
  | "metric_catalog_operator"
  | "provider_feedback_viewer"
  | "provider_customer_metadata_editor";
```

Import that type into `provision-account.ts` instead of maintaining its local
union, and accept all three exact literals in `providerRole`. Keep this path for
initial account provisioning only.

Add this repository method without calling `provision`:

```ts
async grantServiceOperatorRole(
  accountId: string,
  role: ServiceOperatorRole
): Promise<boolean> {
  return this.transaction(async (client) => {
    const account = await client.query(
      "SELECT id FROM accounts WHERE id = $1 AND enabled = true FOR UPDATE",
      [accountId]
    );
    if (account.rowCount !== 1) return false;
    await client.query(
      `INSERT INTO service_operator_roles (account_id, role, enabled)
       VALUES ($1, $2, true)
       ON CONFLICT (account_id, role)
       DO UPDATE SET enabled = true, updated_at = CURRENT_TIMESTAMP`,
      [accountId, role]
    );
    return true;
  });
}
```

Create `grant-service-role.ts` with injectable dependencies like
`provision-account.ts`. It accepts only `DATABASE_URL`, a
`GRANT_ACCOUNT_ID` matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`, and one of the
three exact `GRANT_SERVICE_OPERATOR_ROLE` values. It calls only
`grantServiceOperatorRole`; a missing/disabled account throws a neutral command
error. It outputs only `{ accountId, role, roleGranted: true }`, always closes
the database, and never changes or revokes account sessions. Add the package
script described by the test.

- [ ] **Step 5: Re-run focused tests and typecheck**

```text
npm test -- --run test/schema.test.ts test/provision-account.test.ts test/grant-service-role.test.ts test/auth-service.test.ts test/migrate.test.ts
npm run typecheck
```

Expected: all focused tests pass; migration locking/idempotence and typecheck
remain green.

- [ ] **Step 6: Commit the schema and role primitive**

```text
git add services/api/migrations/012_provider_customer_metadata.sql services/api/src/auth/repository.ts services/api/src/provision-account.ts services/api/src/grant-service-role.ts services/api/package.json services/api/test/schema.test.ts services/api/test/provision-account.test.ts services/api/test/grant-service-role.test.ts services/api/test/auth-service.test.ts
git commit -m "feat(api): add provider customer metadata schema"
```

### Task 2: Metadata Repository And Version Semantics

**Files:**
- Create: `services/api/src/provider-customers/repository.ts`
- Create: `services/api/test/provider-customer-metadata-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Apply all migrations with the existing pg-mem helper, seed an account plus
scopes separately in each of `import_batches`, `fact_versions`,
`diagnostic_runs`, and `action_cards`, and cover this public contract:

```ts
const created = await repository.replace({
  enterpriseId: "ent_demo", storeId: "store_demo",
  customerAlias: "Pilot", providerNote: "Call next week",
  expectedVersion: null, accountId: "account_editor", now
});
expect(created).toEqual({ status: "saved", metadata: expect.objectContaining({ version: 1 }) });

const replaced = await repository.replace({
  enterpriseId: "ent_demo", storeId: "store_demo",
  customerAlias: "Pilot North", providerNote: null,
  expectedVersion: 1, accountId: "account_editor", now: later
});
expect(replaced).toEqual({ status: "saved", metadata: expect.objectContaining({ version: 2 }) });

await expect(repository.replace({
  enterpriseId: "ent_demo", storeId: "store_demo",
  customerAlias: "Stale", providerNote: null,
  expectedVersion: 1, accountId: "account_editor", now: later
})).resolves.toEqual({ status: "conflict" });
```

Also prove:

- `scopeExists` recognizes all four feedback source tables but never the
  metadata table alone.
- `listForScopes` uses one query for all keys and returns a `Map` keyed by a
  collision-safe key function, not one query per scope.
- clear with the correct version deletes the row; missing + null is idempotent;
  missing + integer conflicts.
- the SQL protocol for create uses `ON CONFLICT DO NOTHING RETURNING`, while
  replace and clear contain `WHERE version = $expected RETURNING`; this proves
  two concurrent writes with the same expected version cannot both succeed.
- a database failure propagates without being reclassified as a conflict.

- [ ] **Step 2: Run the repository test and confirm red state**

```text
npm test -- --run test/provider-customer-metadata-repository.test.ts
```

Expected: FAIL because `provider-customers/repository.ts` does not exist.

- [ ] **Step 3: Implement explicit repository types**

Define only metadata-domain types:

```ts
export interface ProviderCustomerScope { enterpriseId: string; storeId: string; }
export interface ProviderCustomerMetadata {
  customerAlias: string | null;
  providerNote: string | null;
  version: number;
  updatedAt: Date;
}
export type ReplaceMetadataResult =
  | { status: "saved"; metadata: ProviderCustomerMetadata }
  | { status: "cleared" }
  | { status: "conflict" };
```

Export `providerCustomerScopeKey(scope)` using a JSON tuple rather than string
concatenation so identifiers cannot collide.

- [ ] **Step 4: Implement batched reads and feedback-source existence**

`listForScopes(scopes)` must return immediately for an empty list. For a
non-empty list, build a bounded `VALUES` parameter-marker list from the number of
server-produced page items and pass every identifier as a query parameter:

```sql
SELECT enterprise_id, store_id, customer_alias, provider_note, version, updated_at
FROM provider_customer_metadata
WHERE (enterprise_id, store_id) IN (VALUES ($1, $2), ($3, $4))
```

The only interpolated SQL is the generated `$N` parameter-marker sequence; no
identifier value is interpolated. The composed page is already bounded to 100
rows, so the query has at most 200 parameters.

Implement `scopeExists` using `SELECT EXISTS` over the exact source union from
`ProviderFeedbackRepository`: `import_batches`, `fact_versions`,
`diagnostic_runs`, and `action_cards`. Do not include the metadata table.

- [ ] **Step 5: Implement atomic create, replace, and clear**

Use one conditional statement per mutation so the database row count is the
optimistic-concurrency decision:

- non-null content plus `expectedVersion: null`: `INSERT ... ON CONFLICT
  (enterprise_id, store_id) DO NOTHING RETURNING ...`;
- non-null content plus an integer version: `UPDATE ... SET ..., version =
  version + 1 WHERE enterprise_id = $1 AND store_id = $2 AND version = $expected
  RETURNING ...`;
- null content plus an integer version: `DELETE ... WHERE enterprise_id = $1
  AND store_id = $2 AND version = $expected RETURNING version`;
- null content plus `expectedVersion: null`: return `cleared` without a query.

Zero returned rows from the first three statements means `conflict`. Set
timestamps from the injected `now` and store `accountId`; never return the
account ID in `ProviderCustomerMetadata`. Do not implement a read-then-write
sequence whose version check could race.

- [ ] **Step 6: Verify repository behavior and commit**

```text
npm test -- --run test/provider-customer-metadata-repository.test.ts test/provider-feedback-repository.test.ts
npm run typecheck
git add services/api/src/provider-customers/repository.ts services/api/test/provider-customer-metadata-repository.test.ts
git commit -m "feat(api): persist provider customer metadata"
```

Expected: metadata tests and unchanged feedback aggregation tests pass.

### Task 3: Validation And Composed Provider-Customer Service

**Files:**
- Create: `services/api/src/provider-customers/service.ts`
- Modify: `services/api/test/provider-customer-metadata-repository.test.ts`

- [ ] **Step 1: Add failing service and normalization tests**

Test exact request keys, identifiers, code-point lengths, newline normalization,
control-character rejection, null/blank normalization, and list composition:

```ts
expect(parseMetadataReplacement({
  customerAlias: "  Pilot \r\n North  ",
  providerNote: "\tCall next week\r\n",
  expectedVersion: null
})).toEqual({
  customerAlias: "Pilot \n North",
  providerNote: "Call next week",
  expectedVersion: null
});

expect(() => parseMetadataReplacement({
  customerAlias: "x".repeat(121), providerNote: null, expectedVersion: null
})).toThrow("customerAlias is invalid");
expect(() => parseMetadataReplacement({
  customerAlias: "Pilot\u0000", providerNote: null, expectedVersion: null
})).toThrow("customerAlias is invalid");
```

Use astral Unicode characters to prove `[...value].length`, not `.length`,
controls limits. Stub feedback and metadata repositories and assert the service
preserves feedback order/cursor, nests the exact row under `feedback`, and
returns `metadata: null` when absent.

- [ ] **Step 2: Run the focused test and confirm red state**

```text
npm test -- --run test/provider-customer-metadata-repository.test.ts
```

Expected: FAIL because the parser and composed service are absent.

- [ ] **Step 3: Implement exact input parsing**

Export these service contracts:

```ts
export interface MetadataReplacement {
  customerAlias: string | null;
  providerNote: string | null;
  expectedVersion: number | null;
}
export class ProviderCustomerNotFoundError extends Error {}
export class ProviderCustomerMetadataConflictError extends Error {}
```

`parseMetadataReplacement` must require exactly the three named keys, normalize
`\r\n` and `\r` to `\n`, trim the complete value, turn blank into null, reject
`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]`, validate alias at 120 and note
at 2,000 code points, and accept only null or a positive safe integer version.
Use the existing identifier regex
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` for both route identifiers.

- [ ] **Step 4: Implement list composition and replacement orchestration**

`ProviderCustomerService.list(query)` calls the unchanged
`ProviderFeedbackService.list(query)`, batch-loads metadata only for returned
rows, and returns:

```ts
{
  items: feedbackPage.items.map((feedback) => ({
    feedback,
    metadata: metadataByScope.get(providerCustomerScopeKey(feedback)) ?? null
  })),
  nextCursor: feedbackPage.nextCursor
}
```

`replace(scope, input, accountId)` first checks `scopeExists`; throw the neutral
not-found error before calling repository replacement. Convert repository
`conflict` into `ProviderCustomerMetadataConflictError`; map saved/cleared to
`{ metadata: publicValueOrNull }`.

- [ ] **Step 5: Verify exact behavior and commit**

```text
npm test -- --run test/provider-customer-metadata-repository.test.ts test/provider-feedback-repository.test.ts
npm run typecheck
git add services/api/src/provider-customers/service.ts services/api/test/provider-customer-metadata-repository.test.ts
git commit -m "feat(api): compose provider customer records"
```

### Task 4: Authorization Capabilities And Provider-Customer Routes

**Files:**
- Modify: `services/api/src/auth/service.ts`
- Modify: `services/api/src/auth/provider-browser-routes.ts`
- Create: `services/api/src/provider-customers/routes.ts`
- Modify: `services/api/src/server.ts`
- Modify: `services/api/test/auth-service.test.ts`
- Modify: `services/api/test/provider-browser-auth-routes.test.ts`
- Create: `services/api/test/provider-customer-routes.test.ts`

- [ ] **Step 1: Write failing multiple-role and capability tests**

Add this auth service contract:

```ts
await expect(service.requireServiceOperatorRoles(token, [
  "provider_feedback_viewer",
  "provider_customer_metadata_editor"
])).resolves.toEqual({ id: "account_editor", displayName: "Editor" });
await expect(service.requireServiceOperatorRoles(editorOnlyToken, [
  "provider_feedback_viewer",
  "provider_customer_metadata_editor"
])).rejects.toBeInstanceOf(AuthorizationError);
```

Update browser login/refresh expectations so capabilities contain exactly:

```ts
{
  providerFeedbackViewer: true,
  metricCatalogOperator: false,
  providerCustomerMetadataEditor: true
}
```

Keep Android `/v1/auth/login` expectations byte-shape unchanged.

- [ ] **Step 2: Write failing route integration tests**

Seed viewer-only, editor-only, both-role, catalog-only, disabled-role, and store
member accounts. Assert:

- GET `/v1/provider-customers?limit=1` is allowed only to a viewer and preserves
  the feedback cursor/filter semantics.
- PUT requires both roles and `X-Provider-Console-Request: 1`.
- editor-only PUT to both a real and unknown scope returns the same neutral 403,
  proving it cannot probe scope existence.
- valid create/replace/clear return the exact `{ metadata }` wrapper.
- invalid request is 422, unavailable scope is 404, stale version is 409, and
  infrastructure failure is a neutral 500.
- the original `/v1/provider-feedback/stores` response contains no `metadata`,
  `customerAlias`, or `providerNote` keys.

Capture Fastify logs. Seed `sentinel-alias` and `sentinel-private-note`; assert
neither appears in any audit or error response. For list audits, customer IDs
must also be absent. For write audits, allow only target IDs plus the specified
operation/version/outcome fields.

- [ ] **Step 3: Run focused tests and confirm red state**

```text
npm test -- --run test/auth-service.test.ts test/provider-browser-auth-routes.test.ts test/provider-customer-routes.test.ts test/provider-feedback-routes.test.ts
```

Expected: FAIL for missing multi-role authorization, capability, and routes;
existing feedback route tests remain green.

- [ ] **Step 4: Implement one-authentication multi-role authorization**

Extend `ProviderCapabilities` with
`providerCustomerMetadataEditor: boolean`. In `providerSession`, derive it from
the enabled role set. Add:

```ts
async requireServiceOperatorRoles(
  accessToken: string,
  requiredRoles: readonly ServiceOperatorRole[]
): Promise<{ id: string; displayName: string }> {
  const account = await this.authenticateAccessToken(accessToken);
  const roles = new Set(await this.repository.listEnabledServiceOperatorRoles(account.id));
  if (requiredRoles.some((role) => !roles.has(role))) {
    throw new AuthorizationError("Service roles are not authorized");
  }
  return account;
}
```

Keep `requireServiceOperatorRole` for existing callers. Update the browser route
session type to the shared `ProviderCapabilities`; do not change Android token
responses.

- [ ] **Step 5: Implement the isolated routes and audits**

Register:

```text
GET /v1/provider-customers
PUT /v1/provider-customers/:enterpriseId/:storeId/metadata
```

Construct one composed service per registered plugin using the existing
database and injected clock:

```ts
const feedback = new ProviderFeedbackService(
  new ProviderFeedbackRepository(options.database),
  options.now
);
const customers = new ProviderCustomerService(
  feedback,
  new ProviderCustomerMetadataRepository(options.database),
  options.now
);
```

GET authorizes with `provider_feedback_viewer`, reuses
`parseProviderFeedbackQuery`, and emits `provider_customer_list_access` in a
best-effort `finally` block. PUT checks the marker first, authenticates the two
roles once, validates identifiers/body, calls the service, and emits
`provider_customer_metadata_write`. Build audit objects from an explicit
allowlist; never spread request bodies, response objects, or errors.

Map exceptions exactly:

```ts
AuthenticationError -> 401 { error: "Authentication required" }
AuthorizationError -> 403 { error: "Provider customer metadata access is required" }
ValidationError -> 422 { error: error.message }
ProviderCustomerNotFoundError -> 404 { error: "Provider customer is not available" }
ProviderCustomerMetadataConflictError -> 409 { error: "Provider customer metadata has changed" }
other -> 500 { error: "Provider customer metadata is unavailable" }
```

Register routes in `buildServer` only beside the existing provider feedback
route when database-backed auth exists and no explicit development context is
active.

- [ ] **Step 6: Verify route, auth, and Android compatibility tests**

```text
npm test -- --run test/provider-customer-routes.test.ts test/provider-feedback-routes.test.ts test/provider-browser-auth-routes.test.ts test/auth-routes.test.ts test/auth-service.test.ts
npm run typecheck
```

Expected: all tests pass; old feedback and Android JSON auth tests require no
response-shape changes.

- [ ] **Step 7: Commit API routes and capability**

```text
git add services/api/src/auth/service.ts services/api/src/auth/provider-browser-routes.ts services/api/src/provider-customers/routes.ts services/api/src/server.ts services/api/test/auth-service.test.ts services/api/test/provider-browser-auth-routes.test.ts services/api/test/provider-customer-routes.test.ts
git commit -m "feat(api): expose provider customer metadata"
```

### Task 5: Narrow Console API And Composed Response Mapping

**Files:**
- Modify: `apps/provider-console/src/api.ts`
- Modify: `apps/provider-console/src/session.ts`
- Modify: `apps/provider-console/src/session.test.ts`
- Modify: `apps/provider-console/src/feedback.ts`
- Modify: `apps/provider-console/src/feedback-workbench.test.tsx`

- [ ] **Step 1: Write failing client route-allowlist tests**

Prove the client permits only:

```ts
await api.fetch("/v1/provider-customers?limit=50");
await api.fetch("/v1/provider-customers/ent_demo/store_demo/metadata", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ customerAlias: "Pilot", providerNote: null, expectedVersion: null })
});
```

Assert GET sends bearer but no provider marker; PUT sends bearer plus
`X-Provider-Console-Request: 1`. Reject absolute/cross-origin paths, encoded
slashes, fragments, GET on the metadata route, PUT on the list route, query
parameters on PUT, and every other `/v1` path before `fetch` is called. Retain
serialized single-refresh behavior for 401 on both allowed route types.

- [ ] **Step 2: Write failing composed mapper tests**

Change the fixture to `{ feedback, metadata }`. Assert only the exact feedback
allowlist and these metadata fields survive parsing:

```ts
expect(page.items[0]).toEqual({
  feedback: expect.objectContaining({ enterpriseId: "ent-alpha", storeId: "store-1" }),
  metadata: {
    customerAlias: "Pilot",
    providerNote: "Internal note",
    version: 2,
    updatedAt: "2026-08-13T02:00:00.000Z"
  }
});
```

Reject malformed versions/timestamps and unknown enum/count values. Seed raw
facts, files, evidence, action text, contacts, account IDs, and authentication
sentinels and prove the parsed model discards them.

- [ ] **Step 3: Run console tests and confirm red state**

```text
npm test -- --run src/session.test.ts src/feedback-workbench.test.tsx
```

Expected: FAIL because the API client only accepts the old feedback path and
the mapper expects flat rows.

- [ ] **Step 4: Implement method-aware exact route validation**

Normalize through `new URL(path, window.location.origin)`, require a leading
single slash, same origin, no hash, and:

- GET with pathname exactly `/v1/provider-customers`;
- PUT with pathname matching
  `^/v1/provider-customers/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}/metadata$`
  and an empty query.

Add the marker only for PUT. Preserve the caller's content type and the existing
memory-only bearer/one-refresh behavior. Do not restore access to the old
feedback route from the browser client; it remains an API compatibility route,
not the console data source.

- [ ] **Step 5: Implement composed types and mutation helper**

In `feedback.ts`, define:

```ts
export interface ProviderCustomerMetadata {
  customerAlias: string | null;
  providerNote: string | null;
  version: number;
  updatedAt: string;
}
export interface ProviderCustomerItem {
  feedback: ProviderFeedbackRow;
  metadata: ProviderCustomerMetadata | null;
}
```

Make `listFeedback` call `/v1/provider-customers`. Add
`replaceProviderCustomerMetadata(api, scope, input)` which URL-encodes each
already validated identifier, sends PUT JSON, validates the exact
`{ metadata: object|null }` response, and never accepts author/account fields.
Extend the console `ProviderCapabilities` type with the editor boolean.

- [ ] **Step 6: Verify client boundaries and commit**

```text
npm test -- --run src/session.test.ts src/feedback-workbench.test.tsx
npm run typecheck
git add apps/provider-console/src/api.ts apps/provider-console/src/session.ts apps/provider-console/src/session.test.ts apps/provider-console/src/feedback.ts apps/provider-console/src/feedback-workbench.test.tsx
git commit -m "feat(console): read provider customer records"
```

### Task 6: Alias And Note Console Editing

**Files:**
- Create: `apps/provider-console/src/provider-customer-editor.tsx`
- Create: `apps/provider-console/src/provider-customer-editor.test.tsx`
- Modify: `apps/provider-console/src/feedback-workbench.tsx`
- Modify: `apps/provider-console/src/feedback-workbench.test.tsx`
- Modify: `apps/provider-console/src/app.tsx`
- Modify: `apps/provider-console/src/app.test.tsx`
- Modify: `apps/provider-console/src/styles.css`

- [ ] **Step 1: Write failing role and presentation tests**

Cover these visible contracts:

- alias is the primary label while enterprise/store IDs remain visible;
- current-page search matches alias and IDs, never note text, and triggers no
  network request;
- viewer-only accounts render alias/note with no edit command;
- both-role accounts render an icon-plus-text Edit command;
- editor-only accounts still receive the no-provider-access page and make no
  customer request;
- strings such as `<img src=x onerror=sentinel>` render as text and never create
  an image element.

- [ ] **Step 2: Write failing editor interaction tests**

Render `ProviderCustomerEditor` with existing and null metadata. Assert:

- form fields initialize from the current server value and show 120/2,000
  limits;
- save submits both fields and current version exactly once while pending;
- create uses `expectedVersion: null`;
- clear submits two null fields with the current version;
- normalized server response replaces the displayed metadata;
- 409 preserves the draft, displays a neutral changed-state message, and offers
  Reload; Reload replaces the draft only after explicit user activation;
- 403 closes/disables editing without logging out; 401 calls the existing
  authentication-required callback; network/5xx keeps the draft and offers
  retry without rendering response text.

- [ ] **Step 3: Run focused tests and confirm red state**

```text
npm test -- --run src/provider-customer-editor.test.tsx src/feedback-workbench.test.tsx src/app.test.tsx
```

Expected: FAIL because the editor and nested customer presentation are absent.

- [ ] **Step 4: Implement the isolated editor component**

`ProviderCustomerEditor` receives `item`, `api`, `onSaved`,
`onAuthenticationRequired`, and `onReloadRequested`. Keep drafts in component
state, use semantic labels and plain `<input>`/`<textarea>`, prevent duplicate
submission, and branch on `Response.status` without displaying response bodies.
Do not use `localStorage`, `sessionStorage`, cookies, HTML injection, a rich-text
library, or automatic conflict merging.

- [ ] **Step 5: Integrate metadata into the workbench**

Keep the existing activity/readiness filters, pagination, loading, denied, and
retry states. Search over:

```ts
const haystack = [
  item.metadata?.customerAlias,
  item.feedback.enterpriseId,
  item.feedback.storeId
].filter(Boolean).join("\n").toLowerCase();
```

Pass `canEditMetadata` from the authenticated capability. On save, replace only
the matching row from the validated server result. On explicit conflict reload,
reload the current filtered first page rather than issuing a new customer-detail
request. Keep layout stable and render notes as wrapped plain text.

- [ ] **Step 6: Verify console behavior, production build, and commit**

```text
npm test
npm run typecheck
npm run build
git add apps/provider-console/src/provider-customer-editor.tsx apps/provider-console/src/provider-customer-editor.test.tsx apps/provider-console/src/feedback-workbench.tsx apps/provider-console/src/feedback-workbench.test.tsx apps/provider-console/src/app.tsx apps/provider-console/src/app.test.tsx apps/provider-console/src/styles.css
git commit -m "feat(console): edit provider customer metadata"
```

Expected: all console tests pass and Vite builds assets under `/provider/`.

### Task 7: Documentation, Privacy Regression, And Cross-System Verification

**Files:**
- Modify: `docs/operations/self-hosted-identity.md`
- Modify: `docs/architecture/current-gap-analysis.md`
- Modify only if a verification failure proves a requirement gap.

- [ ] **Step 1: Update only the affected documentation**

In the identity operations guide, keep `provision:account` for initial account
creation and document `grant:service-role` for existing accounts. Show two
explicit grant runs, one for `provider_feedback_viewer` and one for
`provider_customer_metadata_editor`, because metadata writes require both.
State that the grant command does not change credentials, memberships, or
sessions. Do not document a shortcut that grants store access.

In the gap analysis, move the provider Web console to implemented state, record
customer alias/internal note metadata as implemented, and retain catalog Web
editing, contacts, follow-up workflow, provider multi-tenancy, POS integrations,
and raw customer data access as deferred.

- [ ] **Step 2: Run complete API verification**

From `services/api`:

```text
npm test
npm run typecheck
npm audit --audit-level=high
```

Expected: all API tests and typecheck pass; no high/critical advisory is
introduced. Record existing lower-severity transitive advisories without an
unrelated dependency rewrite.

- [ ] **Step 3: Run complete console and Android verification**

From `apps/provider-console`:

```text
npm test
npm run typecheck
npm run build
```

From repository root:

```text
.\gradlew.bat testDebugUnitTest --rerun-tasks
.\gradlew.bat assembleDebug assembleRelease
```

Expected: console tests/build and unchanged Android unit/debug/release builds
pass.

- [ ] **Step 4: Verify deployment and privacy boundaries**

From repository root:

```text
docker compose config --quiet
docker compose --profile maintenance config --quiet
git diff --check
rg -n "customerAlias|providerNote|provider_note|customer_alias" services/api/src apps/android
rg -n "localStorage|sessionStorage|dangerouslySetInnerHTML|Access-Control-Allow-Origin" apps/provider-console services/api/src/provider-customers
```

Expected: Compose configurations parse; whitespace is clean; metadata symbols
appear only in the dedicated provider modules/auth capability and never under
`apps/android`; there is no browser persistence, HTML injection, or CORS
relaxation. Review every positive search result rather than treating a match as
automatic failure.

- [ ] **Step 5: Request focused code review**

Use `superpowers:requesting-code-review` against the complete branch delta.
Review authorization order, original feedback compatibility, optimistic
concurrency, audit allowlists, response parsing, 409 draft preservation, and
Android regression evidence. For every validated finding, add a regression test,
make the smallest correction, rerun the affected focused and full checks, and
commit a focused `fix(api)` or `fix(console)` change.

- [ ] **Step 6: Commit documentation and final verified state**

```text
git add docs/operations/self-hosted-identity.md docs/architecture/current-gap-analysis.md
git commit -m "docs: record provider customer metadata"
git status --short
```

Expected: documentation commit contains only those two files and the final
working tree is clean. Do not push, deploy, merge, or remove the worktree without
explicit user authorization.
