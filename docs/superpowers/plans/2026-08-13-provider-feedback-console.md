# Provider Feedback Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a same-origin, read-only React console through which authorized service-provider accounts can assess customer feedback aggregates without exposing raw restaurant data.

**Architecture:** Existing `AuthService` remains the session issuer. A browser-specific route module moves refresh tokens into strict cookies and returns a memory-only access token plus server-derived capabilities. A standalone React/Vite application consumes those routes and the current aggregate feedback endpoint. Fastify serves its built assets only below `/provider/`; all `/v1/` paths remain API-owned.

**Tech Stack:** Fastify 5, TypeScript, PostgreSQL via `pg`, React 19, Vite, Vitest, Testing Library, `@fastify/static`.

---

## File Structure

- `services/api/src/auth/repository.ts` 鈥?typed read of all enabled provider roles.
- `services/api/src/auth/service.ts` 鈥?public provider session derived from an authenticated access token.
- `services/api/src/auth/cookies.ts` 鈥?parsing and serialization for the provider refresh cookie.
- `services/api/src/auth/provider-browser-routes.ts` 鈥?browser login, refresh, logout, request-marker checks, neutral errors.
- `services/api/src/provider-console-static.ts` 鈥?static assets and route-safe SPA fallback.
- `services/api/src/server.ts` 鈥?browser/static registration without changing Android JSON auth.
- `services/api/test/provider-browser-auth-routes.test.ts` 鈥?HTTP cookie, capability, marker, and compatibility tests.
- `services/api/test/provider-console-static.test.ts` 鈥?static root/fallback/API isolation tests.
- `apps/provider-console/*` 鈥?independent React/Vite client, session client, feedback workbench, and tests.
- API package/Docker configuration, root Compose and environment example 鈥?build the console into the API image without a console port.

### Task 1: Add Provider Capabilities To Authentication

**Files:**
- Modify: `services/api/src/auth/repository.ts`
- Modify: `services/api/src/auth/service.ts`
- Test: `services/api/test/auth-service.test.ts`

- [ ] **Step 1: Write failing independent-role capability tests**

Seed accounts with neither role, viewer only, catalog only, and both roles. Assert the new safe result precisely:

    expect(await service.providerSession(viewer.accessToken)).toEqual({
      account: { id: "account_viewer", displayName: "Viewer" },
      capabilities: { providerFeedbackViewer: true, metricCatalogOperator: false }
    });

Assert that serialization excludes login name, password hash, refresh token, session ID, and store membership.

- [ ] **Step 2: Confirm the focused test fails**

Run: `npm test -- --run test/auth-service.test.ts`

Expected: FAIL because `providerSession` and a typed all-role repository method are absent.

- [ ] **Step 3: Implement the minimal typed role mapper**

Add one repository query rather than two independent role probes:

    export interface ProviderCapabilities {
      providerFeedbackViewer: boolean;
      metricCatalogOperator: boolean;
    }

    async listEnabledServiceOperatorRoles(accountId: string): Promise<ServiceOperatorRole[]> {
      const result = await this.database.query<Row>(
        "SELECT role FROM service_operator_roles WHERE account_id = $1 AND enabled = true ORDER BY role",
        [accountId]
      );
      return result.rows.map((row) => row.role as ServiceOperatorRole);
    }

Make `providerSession(accessToken)` authenticate first, map only the two known roles to booleans, and return exactly `{ account, capabilities }`.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- --run test/auth-service.test.ts`

Expected: PASS with the existing store and role tests.

    git add services/api/src/auth/repository.ts services/api/src/auth/service.ts services/api/test/auth-service.test.ts
    git commit -m "feat(api): expose provider session capabilities"

### Task 2: Implement Cookie-Backed Provider Browser Authentication

**Files:**
- Create: `services/api/src/auth/cookies.ts`
- Create: `services/api/src/auth/provider-browser-routes.ts`
- Modify: `services/api/src/server.ts`
- Test: `services/api/test/provider-browser-auth-routes.test.ts`
- Test: `services/api/test/auth-routes.test.ts`

- [ ] **Step 1: Write failing browser HTTP-contract tests**

Exercise `buildServer` with pg-mem fixtures. Send the required marker and assert:

    const marker = { "x-provider-console-request": "1" };
    const login = await app.inject({
      method: "POST", url: "/v1/provider-auth/login", headers: marker,
      payload: { loginName: "viewer", password: "passphrase" }
    });
    expect(login.json()).toEqual({
      accessToken: expect.any(String), expiresAt: expect.any(String),
      account: { id: "account_viewer", displayName: "Viewer" },
      capabilities: { providerFeedbackViewer: true, metricCatalogOperator: false }
    });
    expect(login.body).not.toContain("refreshToken");
    expect(login.headers["set-cookie"]).toContain("HttpOnly");
    expect(login.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(login.headers["set-cookie"]).toContain("Path=/v1/provider-auth/");

Cover refresh rotation, failed-refresh clearing, successful and expired-bearer logout clearing, neutral 401s, missing/invalid marker neutral 403s, and production `Secure`. Preserve current `/v1/auth/*` JSON tests unchanged.

- [ ] **Step 2: Confirm the new test fails**

Run: `npm test -- --run test/provider-browser-auth-routes.test.ts`

Expected: FAIL because routes and cookie helpers do not exist.

- [ ] **Step 3: Add strict cookie and route implementation**

Use a provider-specific `provider_refresh` cookie; parse only that cookie and reject duplicates. Production serialization must be:

    provider_refresh=<encoded-token>; HttpOnly; Secure; SameSite=Strict; Path=/v1/provider-auth/; Max-Age=2592000

Support non-secure cookies only through explicit `providerBrowserDevelopmentMode`. Require `X-Provider-Console-Request: 1` on all three browser routes. Login/refresh return `{ accessToken, expiresAt, account, capabilities }`, never `refreshToken`. Refresh rotates via `AuthService.refresh`. Logout tries bearer revocation when present, always expires the same cookie path, and returns neutral 401 when revocation fails. Do not add CORS.

- [ ] **Step 4: Register routes without touching Android contract**

In `buildServer`, register browser routes only when the database-backed auth service exists, alongside `registerAuthRoutes`; retain the exact Android `/v1/auth/*` response behavior.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run test/provider-browser-auth-routes.test.ts test/auth-routes.test.ts test/provider-feedback-routes.test.ts`

Expected: PASS; only Android JSON responses contain a refresh token.

    git add services/api/src/auth/cookies.ts services/api/src/auth/provider-browser-routes.ts services/api/src/server.ts services/api/test/provider-browser-auth-routes.test.ts services/api/test/auth-routes.test.ts
    git commit -m "feat(api): add provider browser sessions"

### Task 3: Create The Isolated React/Vite Console And Session Client

**Files:**
- Create: `apps/provider-console/package.json`, lockfile, `tsconfig.json`, `vite.config.ts`, `index.html`
- Create: `apps/provider-console/src/main.tsx`, `app.tsx`, `api.ts`, `session.ts`, `styles.css`, `test/setup.ts`
- Test: `apps/provider-console/src/session.test.ts`
- Test: `apps/provider-console/src/app.test.tsx`

- [ ] **Step 1: Write failing session-client tests**

Mock `fetch` using Vitest/jsdom and prove restoration sends credentials and the marker while no browser storage is used:

    await session.restore();
    expect(fetch).toHaveBeenCalledWith("/v1/provider-auth/refresh", expect.objectContaining({
      method: "POST", credentials: "same-origin",
      headers: { "X-Provider-Console-Request": "1" }
    }));
    expect(session.accessToken()).toEqual("access-token");
    expect(localStorage.length).toBe(0);

Add concurrent 401 coverage proving one refresh promise is shared, every original request retries once with a replacement bearer token, refresh failure becomes unauthenticated, and a 403 does not refresh.

- [ ] **Step 2: Confirm the new tests fail**

Run: `npm test -- --run src/session.test.ts`

Expected: FAIL because the console/test runner does not exist.

- [ ] **Step 3: Create Vite configuration and memory-only client**

Use scripts:

    "dev": "vite"
    "build": "tsc -b && vite build"
    "test": "vitest run"
    "typecheck": "tsc -b --pretty false"

Set Vite `base: "/provider/"`. Only its development server proxies `/v1` to `http://localhost:3000`. Session code stores access token/account/capabilities in module state; uses `credentials: "same-origin"`; sends the marker only to browser auth; sends bearer only to feedback; never reads/writes browser storage, URL parameters, or JavaScript cookie values.

- [ ] **Step 4: Implement top-level session states**

Implement restoring, login, neutral login failure, no-provider-role, feedback shell, and role-gated catalog-information shell. The login form has semantic labels, blocks duplicate submission, clears password after submit, and logout clears memory in a `finally` block.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run src/session.test.ts src/app.test.tsx`

Expected: PASS for restore, login, neutral error, logout, no-role, serialized 401 retry, and 403 no-refresh.

    git add apps/provider-console
    git commit -m "feat(console): add provider session shell"

### Task 4: Implement The Read-Only Feedback Workbench

**Files:**
- Create: `apps/provider-console/src/feedback.ts`
- Create: `apps/provider-console/src/feedback-workbench.tsx`
- Create: `apps/provider-console/src/feedback-workbench.test.tsx`
- Modify: `apps/provider-console/src/app.tsx`, `styles.css`

- [ ] **Step 1: Write failing workbench contract tests**

Use a fixture containing only permitted aggregate fields. Assert the first request is `/v1/provider-feedback/stores?limit=50`, filter changes reset cursor, Load More forwards its opaque cursor unchanged, and local search creates no request:

    await user.selectOptions(screen.getByLabelText("Activity"), "stale");
    expect(fetch).toHaveBeenLastCalledWith(
      "/v1/provider-feedback/stores?limit=50&activityState=stale", expect.any(Object)
    );
    await user.type(screen.getByLabelText("Current page search"), "store-2");
    expect(fetch).toHaveBeenCalledTimes(2);

Include sentinels for object keys, checksums, source files, evidence, metric values, action text, execution notes, and contacts; assert no sentinel appears in the DOM.

- [ ] **Step 2: Confirm the new test fails**

Run: `npm test -- --run src/feedback-workbench.test.tsx`

Expected: FAIL because `FeedbackWorkbench` is absent.

- [ ] **Step 3: Add narrow response mapper and read-only workbench**

Define local types containing only `ProviderFeedbackRow` fields and validate network shape before JSX:

    export interface FeedbackPage { items: ProviderFeedbackRow[]; nextCursor: string | null; }
    export async function listFeedback(input: FeedbackFilter, accessToken: string): Promise<FeedbackPage> {
      return providerFetch("/v1/provider-feedback/stores?" + query(input), accessToken).then(parseFeedbackPage);
    }

Use a compact work surface, stable table columns, labeled server filters, a local identifier filter, clear count/empty explanations, and explicit Load More/Retry commands. Render state/count labels independently of color. Implement loading, unfiltered empty, local-filter empty, network/5xx retry, 403 feedback denied without logout, and pagination loading. Render catalog information only for `metricCatalogOperator`; add no mutation or raw-data detail panel.

- [ ] **Step 4: Verify and commit**

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS and create `apps/provider-console/dist` with asset URLs below `/provider/`.

    git add apps/provider-console/src
    git commit -m "feat(console): add provider feedback workbench"

### Task 5: Serve Production Assets From Fastify

**Files:**
- Modify: `services/api/package.json`, `package-lock.json`, `src/server.ts`, `Dockerfile`
- Create: `services/api/src/provider-console-static.ts`
- Modify: `docker-compose.yml`, `.env.example`
- Test: `services/api/test/provider-console-static.test.ts`

- [ ] **Step 1: Write failing static route tests**

Pass a temporary fixture directory with a dedicated `providerConsoleDistDir` server option. Assert:

    expect((await app.inject({ method: "GET", url: "/provider/" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/provider/customers" })).headers["content-type"]).toContain("text/html");
    expect((await app.inject({ method: "GET", url: "/v1/not-a-route" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/provider/assets/app.js" })).body).toContain("fixture asset");

Also prove an absent dist directory leaves API-only server tests operational rather than crashing startup.

- [ ] **Step 2: Confirm the new test fails**

Run: `npm test -- --run test/provider-console-static.test.ts`

Expected: FAIL because no static mount exists.

- [ ] **Step 3: Add route-safe static delivery**

Install `@fastify/static`. Register assets under `/provider/assets/`, then explicitly serve `index.html` for non-asset `/provider/*`. Do not use a root wildcard or global not-found handler: unknown `/v1/*` remains API 404.

- [ ] **Step 4: Build console into the API image**

Use a Node build stage that installs/builds `apps/provider-console`, copies its `dist` to the final API image, and retains the existing runtime command. Do not expose a Vite port or add a Compose console service. Document `PROVIDER_BROWSER_DEVELOPMENT_MODE=false` and production HTTPS without weakening `AUTH_TOKEN_SECRET`.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- --run test/provider-console-static.test.ts test/provider-browser-auth-routes.test.ts`

Expected: PASS.

Run from repository root: `docker compose config --quiet`

Expected: PASS; default services remain `postgres`, `minio`, `api` plus existing maintenance profiles only.

Run from repository root: `docker build -f services/api/Dockerfile .`

Expected: PASS with provider assets in the final image.

    git add services/api/package.json services/api/package-lock.json services/api/src/provider-console-static.ts services/api/src/server.ts services/api/Dockerfile services/api/test/provider-console-static.test.ts docker-compose.yml .env.example
    git commit -m "feat(api): serve provider console assets"

### Task 6: Cross-System Verification And Review

**Files:**
- Modify only when verification identifies a concrete requirement gap.

- [ ] **Step 1: Run API verification**

Run from `services/api`:

    npm test
    npm run typecheck
    npm audit --audit-level=high

Expected: test/typecheck pass and no high/critical vulnerability. Record existing lower-severity advisories rather than changing unrelated dependencies.

- [ ] **Step 2: Run console and Android verification**

Run from `apps/provider-console`:

    npm test
    npm run typecheck
    npm run build

Run from repository root (where the Gradle Wrapper lives):

    .\\gradlew.bat testDebugUnitTest --rerun-tasks
    .\\gradlew.bat assembleDebug assembleRelease

Expected: all commands pass and Android behavior remains unchanged.

- [ ] **Step 3: Verify deployment and privacy boundaries**

Run from repository root:

    docker compose config --quiet
    docker compose --profile maintenance config --quiet
    git diff --check
    rg -n "localStorage|sessionStorage|refreshToken|Access-Control-Allow-Origin|objectKey|checksum|sourceLocator|executionNote" apps/provider-console services/api/src/auth/provider-browser-routes.ts

Expected: Compose configurations parse, no whitespace errors, and no production refresh-token persistence, CORS relaxation, or sensitive feedback rendering.

- [ ] **Step 4: Request focused code review**

Use `superpowers:requesting-code-review`. For each validated finding, add a regression test, make the smallest repair, rerun the affected check, and commit a focused `fix(api)` or `fix(console)` change.
