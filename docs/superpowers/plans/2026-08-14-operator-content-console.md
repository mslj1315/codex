# Operator Content Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incomplete operator-content prototype with a usable React/Vite internal console and a single-admin, session-authenticated, versioned template/rule management API.

**Architecture:** The API owns account passwords, opaque HttpOnly sessions, CSRF secrets, operator-admin authorization, immutable logical-item/version/audit records, and published-only reads. `apps/provider-console` is a same-origin React/Vite application that holds only UI state and server-issued CSRF material; it never stores a password, token, customer data, or model key. Existing Android, imports, and provider/customer routes retain their contracts.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, pg, Vitest, React, Vite, TypeScript, bcrypt password hashing, browser Fetch with credentialed same-origin requests.

---

## File Structure

- `services/api/migrations/015_operator_accounts_sessions.sql`: append-only operator identity, session, CSRF, logical item, version, and audit schema. Supersedes the incomplete 014 operator-content tables with a later append-only migration; never rewrite applied migrations.
- `services/api/src/operator-auth/`: password hashing, account/session repository, login/logout/session routes, CSRF validation, controlled provisioning CLI.
- `services/api/src/operator-content/`: replace prototype repositories/routes with logical-item/version/audit services, published-only selectors, and transient rule preview.
- `services/api/test/operator-auth.test.ts`: account, session, CSRF, disabled-account, and neutral forbidden tests.
- `services/api/test/operator-content-routes.test.ts`: version lifecycle, immutable published records, published-only reads, malformed requests, and provider isolation.
- `apps/provider-console/`: new Vite React application, session-aware request client, app shell, template/rule list/detail/edit flows, and component tests.

### Task 1: Establish Operator Accounts, Sessions, And CSRF

**Files:**
- Create: `services/api/migrations/015_operator_accounts_sessions.sql`
- Create: `services/api/src/operator-auth/repository.ts`
- Create: `services/api/src/operator-auth/routes.ts`
- Create: `services/api/src/operator-auth/provision.ts`
- Create: `services/api/test/operator-auth.test.ts`
- Modify: `services/api/src/server.ts`, `services/api/package.json`, `.env.example`

- [ ] **Step 1: Write failing session and authorization tests**

Test `POST /v1/operator-auth/login` with a seeded admin account, a wrong password, disabled account, session-expiry lookup, logout revocation, and an operator-content POST without CSRF. Assert success returns a `Set-Cookie` HttpOnly/SameSite session plus `{ csrfToken, capabilities: { operatorAdmin: true } }`; all failures use a neutral body.

```ts
const login = await app.inject({ method: "POST", url: "/v1/operator-auth/login", payload: { accountId: "op-1", password: "correct horse" } });
expect(login.statusCode).toBe(200);
expect(login.headers["set-cookie"]).toContain("HttpOnly");
expect(login.json().capabilities).toEqual({ operatorAdmin: true });
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm test -- --run test/operator-auth.test.ts`

Expected: FAIL because the routes, tables, and account repository do not exist.

- [ ] **Step 3: Add append-only account/session migration**

Create `operator_accounts(account_id, password_hash, enabled, role CHECK role='operator_admin', created_at, disabled_at)`, `operator_sessions(id, account_id, secret_hash, csrf_secret, expires_at, revoked_at)`, and an audit table. Store only hashes of random session secrets. Add a trigger that prevents account-ID/role/password-hash history rewrites and prevents audit deletion; disabling remains an explicit, auditable transition.

```sql
CREATE TABLE operator_accounts (
  account_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'operator_admin'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disabled_at TIMESTAMPTZ
);
```

- [ ] **Step 4: Implement password/session repository and controlled provision CLI**

Use bcrypt with a configurable work factor. `createSession` generates random cookie and CSRF secrets, stores only cookie-secret hash, and expires old sessions. `provision.ts` validates account ID/password/role before opening the database, hashes the password, and upserts only the controlled admin account.

```ts
export interface OperatorSession { accountId: string; role: 'operator_admin'; csrfToken: string; expiresAt: Date; }
export async function authenticateSession(cookieValue: string | undefined): Promise<OperatorSession | undefined>;
```

- [ ] **Step 5: Implement session routes and hook**

Register login, logout, and current-session endpoints. For state-changing `/v1/operator-content/*` routes require same-origin request headers and `X-CSRF-Token` matching the current session. Do not alter `TrustedContext`, Android, import, or development-context behavior.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- --run test/operator-auth.test.ts test/operator-content-routes.test.ts`

Run: `npm run typecheck && git diff --check`

Commit: `feat(api): add operator admin sessions`

### Task 2: Replace Prototype Content Tables With Immutable Logical Versions

**Files:**
- Create: `services/api/migrations/016_operator_content_versions.sql`
- Modify: `services/api/src/operator-content/template-repository.ts`
- Modify: `services/api/src/operator-content/rule-repository.ts`
- Modify: `services/api/src/operator-content/routes.ts`
- Modify: `services/api/test/operator-content-routes.test.ts`

- [ ] **Step 1: Write failing logical-version lifecycle tests**

Test that one admin creates template v1 draft, publishes it, creates a v2 draft from the same logical item, and publishes v2 without mutating v1. Test matching returns only latest enabled published version; disabled versions do not match. Test equivalent rule lifecycle and audit events.

```ts
expect(v1).toMatchObject({ logicalId, version: 1, status: 'published' });
expect(v2).toMatchObject({ logicalId, version: 2, status: 'draft' });
expect((await app.inject({ method: 'GET', url: `/v1/operator-content/templates/${logicalId}/versions/1` })).json().content.hook).toBe('original');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --run test/operator-content-routes.test.ts`

Expected: FAIL because the prototype mutates a single `content_templates` row and has submitted/returned states.

- [ ] **Step 3: Add versioned logical schema and migration bridge**

Do not edit 014. Create logical-item tables, version tables, and audit-event tables for templates/rules. Version uniqueness is `(logical_id, version)`. State check is exactly `draft`, `published`, `disabled`. Migrate any prototype rows to v1 logical versions when present. Add PostgreSQL triggers rejecting update/delete of published versions and all audit events.

- [ ] **Step 4: Implement single-admin repositories**

Expose `createLogicalItem`, `saveDraft`, `publishDraft`, `disablePublished`, `listLogicalItems`, `getVersion`, `listVersions`, `matchPublishedTemplates`, `listPublishedRules`, and `previewRule`. `saveDraft` on a published logical item creates version `max(version)+1` in one transaction with a per-logical-item lock. Validate all structured template fields and rule fields from the design.

```ts
export type VersionStatus = 'draft' | 'published' | 'disabled';
export interface RuleInput { name: string; patterns: string[]; semanticCategories: string[]; severity: RuleSeverity; platform: string; scope: string; guidance: string; }
```

- [ ] **Step 5: Replace routes with session-derived single-admin API**

Remove editor/reviewer/submit/return endpoints. Add exact routes for list/create/detail/version/draft-save/publish/disable and rule preview. Route authorization comes only from `operator-auth` session capability. Provider, Android, trusted-context callers, and missing session receive `{ error: 'Forbidden' }` without version/content disclosure.

- [ ] **Step 6: Verify GREEN and commit**

Run: `npm test -- --run test/operator-content-routes.test.ts test/operator-auth.test.ts test/migrate.test.ts`

Run: `npm run typecheck && git diff --check`

Commit: `feat(api): version operator content library`

### Task 3: Scaffold The React/Vite Operator Console And Session Client

**Files:**
- Create: `apps/provider-console/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`
- Create: `apps/provider-console/src/main.tsx`, `app.tsx`, `session.ts`, `api.ts`, `styles.css`
- Create: `apps/provider-console/src/session.test.ts`, `api.test.ts`, `app.test.tsx`
- Modify: root `.gitignore` only if Vite output is not already ignored

- [ ] **Step 1: Write failing console tests**

Test login form submits only account/password to `POST /v1/operator-auth/login`; session client stores only in-memory CSRF token; every mutation sends same-origin credentials and `X-CSRF-Token`; no request path outside the fixed allowlist is accepted. Test expired session returns to login without rendering operator navigation.

- [ ] **Step 2: Initialize Vite React project and run RED**

Create the minimal package files using React, Vite, Vitest, Testing Library, and jsdom. Run: `npm test -- --run src/session.test.ts src/api.test.ts src/app.test.tsx`

Expected: FAIL until session/api/app modules exist.

- [ ] **Step 3: Implement session-aware API client**

Use `fetch` with `credentials: 'include'`, fixed same-origin method/path allowlists, JSON request parsing, neutral errors, and an in-memory CSRF token. Reject caller-supplied `Authorization`, arbitrary URLs, and route escapes.

```ts
export async function sendOperatorRequest(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown>;
```

- [ ] **Step 4: Implement login and app shell**

Create a compact left navigation for Templates and Review Rules after `GET /v1/operator-auth/session` yields `operatorAdmin`. Render plain-text error/loading/empty states. No provider/customer/raw-data navigation is present.

- [ ] **Step 5: Verify GREEN and commit**

Run from `apps/provider-console`: `npm test`, `npm run typecheck`, `npm run build`

Run: `git diff --check`

Commit: `feat(console): add operator admin session shell`

### Task 4: Implement Template And Rule Management Screens

**Files:**
- Create: `apps/provider-console/src/operator-content/template-list.tsx`, `template-editor.tsx`, `rule-list.tsx`, `rule-editor.tsx`, `rule-preview.tsx`
- Create: matching `*.test.tsx` files
- Modify: `apps/provider-console/src/app.tsx`, `api.ts`, `styles.css`

- [ ] **Step 1: Write failing interaction tests**

Cover list/detail/version history, create draft, edit fields, publish, disable, rule preview, safe text rendering, 401 return-to-login, 403 neutral state, 409 version conflict with preserved draft, and no unsafe HTML rendering.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run src/operator-content/*.test.tsx`

Expected: FAIL because the management components and API composition do not exist.

- [ ] **Step 3: Implement structured template editor**

Use labelled native inputs/textareas/selects for every specified template field. Publish only after required fields validate. On an existing published logical item, save creates the next draft version. Present version history and disabled state as read-only text.

- [ ] **Step 4: Implement rule editor and transient preview**

Support patterns, semantic categories, severity, platform, scope, and guidance. Rule preview posts only the supplied preview text and current draft payload, displays normalized matches/guidance, and does not persist preview input.

- [ ] **Step 5: Verify GREEN and commit**

Run from `apps/provider-console`: `npm test`, `npm run typecheck`, `npm run build`

Run from `services/api`: `npm test`, `npm run typecheck`

Run: `git diff --check`

Commit: `feat(console): manage operator content versions`

### Task 5: Cross-Boundary Verification And Documentation

**Files:**
- Modify: `.env.example`, `docs/architecture/current-gap-analysis.md` if present, relevant operations documentation
- Test: API full suite, console full suite, Android regression command where SDK exists

- [ ] **Step 1: Verify migrations and privacy boundaries**

Run full API migration tests in order. Search runtime code for `password_hash`, session secret, model keys, raw customer reports, `dangerouslySetInnerHTML`, localStorage/sessionStorage, and arbitrary fetch URLs. Confirm logs/errors do not emit secrets or raw content.

- [ ] **Step 2: Verify production console behavior**

Run from `apps/provider-console`: `npm test && npm run typecheck && npm run build`.

Confirm production output does not embed development credentials, API base URLs, model keys, or local HTTP exceptions.

- [ ] **Step 3: Verify Android and existing API contracts**

Run `./gradlew :apps:android:app:testDebugUnitTest` when the Android SDK is available; otherwise record the precise SDK failure without modifying machine configuration. Re-run import and profile API tests and confirm their route payloads remain unchanged.

- [ ] **Step 4: Update operations documentation and commit**

Document account provisioning, password/session rotation, CSRF behavior, draft/publish/disable lifecycle, rule preview privacy, and explicit non-scope. Run `git diff --check`.

Commit: `docs: document operator content console`
