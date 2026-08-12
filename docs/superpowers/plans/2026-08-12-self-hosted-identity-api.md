# Self-Hosted Identity API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed production trusted context with account authentication, database-backed sessions, and server-derived store authorization.

**Architecture:** PostgreSQL owns accounts, refresh sessions, memberships, and provider roles. Narrow `src/auth` modules own credentials, token parsing, database access, and HTTP routing. Existing import routes retain `TrustedContext`, but production resolves it from a bearer token plus a matching enabled membership.

**Tech Stack:** TypeScript, Fastify 5, Node `crypto` (`scrypt`, HMAC-SHA-256, `timingSafeEqual`), PostgreSQL, pg-mem, Vitest.

---

### Task 1: Identity Schema And Pure Security Primitives

**Files:**
- Create: `services/api/migrations/011_identity.sql`
- Create: `services/api/src/auth/credentials.ts`
- Create: `services/api/src/auth/tokens.ts`
- Create: `services/api/test/auth-credentials.test.ts`
- Create: `services/api/test/auth-tokens.test.ts`
- Modify: `services/api/test/schema.test.ts`

- [ ] **Step 1: Write failing migration, password, and token tests**

```ts
it("enforces unique accounts, scoped memberships, sessions, and global roles", async () => {
  await migrate(database);
  await database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('a1', 'owner', 'Owner', 'x')");
  await expect(database.query("INSERT INTO accounts (id, login_name, display_name, password_hash) VALUES ('a2', 'owner', 'Other', 'x')")).rejects.toThrow();
});

it("hashes and verifies passwords", async () => {
  const hash = await hashPassword("correct horse battery staple", fixedRandom);
  expect(hash).toMatch(/^scrypt\\$v1\\$/);
  await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
});

it("rejects expired, tampered, and wrong-version access tokens", () => {
  const token = issueAccessToken({ accountId: "a1", sessionId: "s1" }, secret, now);
  expect(parseAccessToken(token, secret, now)).toMatchObject({ accountId: "a1", sessionId: "s1" });
  expect(() => parseAccessToken(`${token}x`, secret, now)).toThrow(AuthenticationError);
});
```

- [ ] **Step 2: Run focused tests and confirm they fail because the migration/modules are absent**

Run: `npm test -- --run test/schema.test.ts test/auth-credentials.test.ts test/auth-tokens.test.ts`

- [ ] **Step 3: Add migration and primitives**

Create `accounts`, `account_sessions`, `store_memberships`, and
`service_operator_roles`. Require normalized unique login names; use opaque text
IDs; restrict membership role to `owner|operator`; restrict provider role to
`metric_catalog_operator|provider_feedback_viewer`; store only SHA-256 refresh
token hashes. Implement password serialization as
`scrypt$v1$<salt-base64url>$<derived-base64url>`, constant-time verification,
base64url HMAC-SHA-256 access tokens, 15-minute expiry, 32-byte refresh tokens,
and explicit `AuthenticationError` for malformed/expired/tampered tokens.

- [ ] **Step 4: Run the same focused tests and confirm green state**

Run: `npm test -- --run test/schema.test.ts test/auth-credentials.test.ts test/auth-tokens.test.ts`

- [ ] **Step 5: Commit the isolated schema/primitives increment**

Run:
```text
git add services/api/migrations/011_identity.sql services/api/src/auth/credentials.ts services/api/src/auth/tokens.ts services/api/test/schema.test.ts services/api/test/auth-credentials.test.ts services/api/test/auth-tokens.test.ts
git commit -m "feat(api): add identity primitives"
```

### Task 2: Sessions, Memberships, And Server-Derived Context

**Files:**
- Create: `services/api/src/auth/repository.ts`
- Create: `services/api/src/auth/service.ts`
- Create: `services/api/test/auth-service.test.ts`
- Modify: `services/api/src/imports/routes.ts`
- Modify: `services/api/test/import-routes.test.ts`

- [ ] **Step 1: Write failing session lifecycle and scope-isolation tests**

```ts
it("rotates refresh sessions and rejects replay", async () => {
  const first = await service.login({ loginName: "owner", password: "passphrase" });
  const second = await service.refresh({ refreshToken: first.refreshToken });
  await expect(service.refresh({ refreshToken: first.refreshToken })).rejects.toBeInstanceOf(AuthenticationError);
  expect(second.accessToken).not.toEqual(first.accessToken);
});

it("derives enterprise and actor from the membership, not request data", async () => {
  await expect(resolver(requestWithBearer(token, "store_other"))).resolves.toBeUndefined();
  await expect(resolver(requestWithBearer(token, "store_demo"))).resolves.toEqual({
    enterpriseId: "ent_demo", storeId: "store_demo", actorId: "account_owner"
  });
});
```

- [ ] **Step 2: Run focused tests and confirm red state**

Run: `npm test -- --run test/auth-service.test.ts test/import-routes.test.ts`

- [ ] **Step 3: Implement repository/service/resolver boundary**

Add `AuthRepository` methods for account lookup, session creation, refresh-token
lookup under row lock, rotation, session revocation, enabled-membership lookup,
and member store listing. `AuthService` exposes `login`, `refresh`, `logout`,
`authenticateAccessToken`, `listStores`, and `resolveStoreContext`. Refresh
rotation must happen in one transaction: lock prior session, reject revoked or
expired session/disabled account, revoke it, create a replacement, then commit.

Export `authenticatedContextResolver(auth)` from `imports/routes.ts`. It reads
only a bearer token and the URL `storeId`, calls `resolveStoreContext`, and
returns `undefined` when authentication or membership fails. It must not read
enterprise/actor/store headers or request-body identity fields. Keep explicit
development resolvers unchanged.

- [ ] **Step 4: Re-run focused tests and confirm green state**

Run: `npm test -- --run test/auth-service.test.ts test/import-routes.test.ts`

- [ ] **Step 5: Commit the context derivation increment**

Run:
```text
git add services/api/src/auth/repository.ts services/api/src/auth/service.ts services/api/src/imports/routes.ts services/api/test/auth-service.test.ts services/api/test/import-routes.test.ts
git commit -m "feat(api): derive store context from memberships"
```

### Task 3: Auth HTTP Routes And Production Startup Protection

**Files:**
- Create: `services/api/src/auth/routes.ts`
- Create: `services/api/test/auth-routes.test.ts`
- Modify: `services/api/src/server.ts`
- Modify: `services/api/test/server.test.ts`

- [ ] **Step 1: Write failing HTTP contract and startup-guard tests**

```ts
it("uses one neutral 401 response for missing bearer, invalid bearer, and bad credentials", async () => {
  for (const request of [missingBearer, invalidBearer, badCredentials]) {
    const response = await app.inject(request);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "Authentication required" });
  }
});

it("lists only enabled stores and revokes the session on logout", async () => {
  const login = await loginOwner(app);
  expect((await app.inject(memberStoreRequest(login.accessToken))).json().stores)
    .toEqual([{ enterpriseId: "ent_demo", storeId: "store_demo", role: "owner" }]);
  expect((await app.inject(logoutRequest(login.accessToken))).statusCode).toBe(204);
});

it("rejects database-backed production startup without an auth secret", () => {
  expect(() => buildServer({ database, objectStorage })).toThrow("AUTH_TOKEN_SECRET is required");
});
```

- [ ] **Step 2: Run focused tests and confirm red state**

Run: `npm test -- --run test/auth-routes.test.ts test/server.test.ts`

- [ ] **Step 3: Add routes and configuration selection**

Register only `POST /v1/auth/login`, `POST /v1/auth/refresh`,
`POST /v1/auth/logout`, and `GET /v1/auth/me/stores`. Validate request bodies
using the existing route style. Map every authentication failure to exactly
`401 { error: "Authentication required" }`; never serialize an exception or
credential. In `buildServer`, when a database exists and no explicit
development resolver is selected, require a nonblank `authTokenSecret`, create
the auth service, register auth routes, and use `authenticatedContextResolver`.
Never fall back to demo context in production.

- [ ] **Step 4: Re-run focused tests and confirm green state**

Run: `npm test -- --run test/auth-routes.test.ts test/server.test.ts`

- [ ] **Step 5: Commit the authenticated API boundary**

Run:
```text
git add services/api/src/auth/routes.ts services/api/src/server.ts services/api/test/auth-routes.test.ts services/api/test/server.test.ts
git commit -m "feat(api): add authenticated API boundary"
```

### Task 4: Controlled Provisioning CLI And Deployment Documentation

**Files:**
- Create: `services/api/src/provision-account.ts`
- Create: `services/api/test/provision-account.test.ts`
- Modify: `services/api/package.json`
- Modify: `.env.example`
- Create: `docs/operations/self-hosted-identity.md`

- [ ] **Step 1: Write a failing injectable CLI test**

```ts
it("provisions an account, membership, and optional provider role transactionally", async () => {
  await runProvision(dependencies);
  expect(calls).toEqual(["database", "begin", "account", "membership", "role", "commit", "output", "end"]);
  expect(output).toEqual('{"accountId":"account_owner","membershipGranted":true,"serviceOperatorRoleGranted":true}\n');
});

it("does no database work without configuration and never emits password material", async () => {
  await expect(runProvision({ ...dependencies, env: {} })).rejects.toThrow(ProvisioningError);
  expect(output).not.toContain("passphrase");
});
```

- [ ] **Step 2: Run the focused CLI test and confirm red state**

Run: `npm test -- --run test/provision-account.test.ts`

- [ ] **Step 3: Implement the controlled CLI**

Require `DATABASE_URL`, `PROVISION_LOGIN_NAME`, `PROVISION_DISPLAY_NAME`,
`PROVISION_PASSWORD`, `PROVISION_ENTERPRISE_ID`, `PROVISION_STORE_ID`, and
`PROVISION_STORE_ROLE`. Permit an optional provider role only when it is one of
the two schema role values. Normalize login names, validate opaque IDs, hash the
password, transactionally create/update account and grants, write one
non-secret JSON summary, and always close the database. Process failures write
only `Account provisioning failed` to stderr and exit 1. Add the
`provision:account` script and document TLS, `AUTH_TOKEN_SECRET`, provisioning,
rotation, and the absence of public sign-up.

- [ ] **Step 4: Re-run the focused CLI test and confirm green state**

Run: `npm test -- --run test/provision-account.test.ts`

- [ ] **Step 5: Commit the provisioning increment**

Run:
```text
git add services/api/src/provision-account.ts services/api/test/provision-account.test.ts services/api/package.json .env.example docs/operations/self-hosted-identity.md
git commit -m "feat(api): add controlled account provisioning"
```

### Task 5: Full Verification And Accurate State Documentation

**Files:**
- Modify: `docs/architecture/current-gap-analysis.md`

- [ ] **Step 1: Update product state without overclaiming**

Mark API account/session/membership authentication and controlled provider roles
as implemented. Keep Android login/session UI and provider feedback projection
as subsequent work; do not mark either complete.

- [ ] **Step 2: Run the full API and deployment checks**

Run from `services/api`:
```text
npm test
npm run typecheck
npm audit --audit-level=high
```

Run from repository root:
```text
docker compose config --quiet
docker compose --profile maintenance config --quiet
git diff --check
```

Expected: all API tests and typecheck pass; audit has no high/critical finding;
both Compose configurations parse; default Compose does not add a provisioning
or feedback service; diff check is clean.

- [ ] **Step 3: Commit the state-documentation update**

Run:
```text
git add docs/architecture/current-gap-analysis.md
git commit -m "docs: record authenticated API boundary"
```

## Follow-On Plans

After this API plan passes, create separate plans for Android login/session
storage and the authenticated provider feedback projection. The feedback plan
must require `provider_feedback_viewer`, bounded pagination, aggregate-only
fields, and audit logging; it must never reuse store routes or expose raw
business data.
