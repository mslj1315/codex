# Unified Admin RBAC And Model Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate internal consoles with one Chinese `/admin/` application providing configurable internal RBAC, customer mobile-number provisioning, encrypted model configuration, and administrator-assigned customer model selection.

**Architecture:** PostgreSQL stores internal roles, permissions, account bindings, customer password-change state, encrypted model records, and safe audit rows. Fastify checks functional permissions before each repository call; the single React console consumes a safe permission summary. A server-only master encryption key encrypts API keys, while all customer raw-content routes remain customer-only regardless of `super_admin`.

**Tech Stack:** PostgreSQL migrations/triggers, Fastify/TypeScript, bcrypt, Node crypto AES-256-GCM, React/Vite, Vitest, Android Kotlin/Retrofit.

---

### Task 1: Internal Permission Foundation

**Files:**
- Create: `services/api/migrations/030_internal_rbac.sql`
- Create: `services/api/src/admin/rbac.ts`
- Modify: `services/api/src/auth/service.ts`, `services/api/src/server.ts`
- Test: `services/api/test/internal-rbac.test.ts`

- [ ] **Step 1: Write failing API tests**

Test role union, `super_admin` full internal permissions, and denial before repository query.

```ts
expect(await app.inject({ method: "GET", url: "/v1/admin/accounts", headers: bearer(editor) })).toMatchObject({ statusCode: 403 });
expect(pool.query).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run RED**

Run: `cd services/api; npm test -- --run test/internal-rbac.test.ts`

Expected: FAIL because admin roles/permissions and route guard do not exist.

- [ ] **Step 3: Implement migration and guard**

Create `internal_permissions`, `internal_roles`, `internal_role_permissions`, `internal_account_roles`, and append-only `internal_audit_events`. Define stable codes in `rbac.ts`; `requireInternalPermission` resolves trusted identity and throws 403 before callback/repository use. `super_admin` returns all defined codes but does not alter customer route guards.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm test -- --run test/internal-rbac.test.ts; npm run typecheck; git diff --check`

Commit: `git add services/api; git commit -m "feat: add internal functional permissions"`

### Task 2: Customer Mobile Account Provisioning

**Files:**
- Create: `services/api/src/admin/customer-accounts.ts`, `services/api/src/admin/customer-account-routes.ts`
- Modify: `services/api/migrations/031_customer_account_security.sql`, `services/api/src/auth/routes.ts`
- Test: `services/api/test/customer-account-admin.test.ts`, `services/api/test/auth-routes.test.ts`

- [ ] **Step 1: Write failing tests**

Test normalized mobile login, one-time temporary password returned only once, bcrypt-only storage, forced first password change, reset revocation, and 403 for customer access to `/v1/admin`.

```ts
expect(response.json()).toMatchObject({ loginName: "13800138000", temporaryPassword: expect.any(String) });
expect(await db.query("select password_hash from accounts where id=$1", [id])).not.toContain(response.json().temporaryPassword);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- --run test/customer-account-admin.test.ts test/auth-routes.test.ts`

Expected: FAIL because admin account endpoints and change-required state are absent.

- [ ] **Step 3: Implement customer lifecycle**

Add `password_change_required`; create/reset only through `customer_accounts.create`/`reset_password`; generate with `randomBytes`, hash with bcrypt, audit safe targets, revoke active sessions on reset, and require `/v1/auth/change-password` before normal customer workflow calls.

- [ ] **Step 4: Run GREEN and commit**

Run: focused tests, `npm run typecheck`, `git diff --check`.

Commit: `git commit -m "feat: manage customer mobile accounts"`

### Task 3: Encrypted Model Configurations And Assignments

**Files:**
- Create: `services/api/migrations/032_model_configurations.sql`, `services/api/src/admin/model-configs.ts`, `services/api/src/admin/model-config-routes.ts`
- Modify: `services/api/src/model-providers/generation.ts`, `.env.example`
- Test: `services/api/test/admin-model-configs.test.ts`

- [ ] **Step 1: Write failing tests**

Test HTTPS configuration validation, AES-GCM ciphertext at rest, no plaintext/ciphertext in GET, default/customer precedence, disabled rejection, key rotation audit, and customer raw route denial for super admin.

```ts
expect(await app.inject({ method: "GET", url: `/v1/admin/model-configs/${id}`, headers })).not.toContain("sk-");
expect(resolveModel(customerWithOverride).id).toBe(overrideId);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- --run test/admin-model-configs.test.ts`

Expected: FAIL because encrypted configuration records and assignment resolver do not exist.

- [ ] **Step 3: Implement server-only encryption and resolver**

Require `MODEL_CONFIG_ENCRYPTION_KEY` environment key; validate exact HTTPS roots; encrypt API key with AES-256-GCM; return only label/provider/model/base URL/key suffix/state. Allow `model_configs.manage` to rotate/enable/default and `model_assignments.manage` to assign customer overrides. The generation adapter decrypts only immediately before model transport.

- [ ] **Step 4: Run GREEN and commit**

Run focused tests, `npm run typecheck`, `git diff --check`.

Commit: `git commit -m "feat: manage encrypted model configurations"`

### Task 4: Unified Chinese Admin API And Console

**Files:**
- Create: `apps/admin-console/`
- Create: `services/api/src/admin/routes.ts`
- Modify: `services/api/Dockerfile`, `services/api/src/server.ts`, `.env.example`
- Test: `services/api/test/admin-console-static.test.ts`, `apps/admin-console/src/app.test.tsx`

- [ ] **Step 1: Write failing route/UI tests**

Test `/admin/` static delivery, Chinese navigation from permission summary, inaccessible menu absence, and no raw customer/model-key fields rendered.

```ts
expect(screen.queryByText("模型配置")).toBeNull();
expect(await app.inject({ method: "GET", url: "/admin/" })).toMatchObject({ statusCode: 200 });
```

- [ ] **Step 2: Run RED**

Run API/admin console focused tests. Expected: missing application/static route.

- [ ] **Step 3: Implement console**

Build one Chinese Vite application with Overview, Customer Management, Content Operations, Model Operations, and Access Management. Use permission codes for navigation/actions; use API DTOs that exclude protected fields. Package only its `dist` in the API image.

- [ ] **Step 4: Run GREEN and commit**

Run API tests/typecheck, `cd apps/admin-console; npm test; npm run build`, and diff check.

Commit: `git commit -m "feat: add unified Chinese admin console"`

### Task 5: Legacy Entry Migration, Android First-Login Gate, And Final Verification

**Files:**
- Modify: `services/api/src/provider-console-static.ts`, `services/api/src/operator-console-static.ts`, `services/api/src/auth/routes.ts`
- Modify: `apps/android/app/src/main/.../Session*.kt`
- Test: `services/api/test/admin-migration.test.ts`, `apps/android/app/src/test/.../SessionTest.kt`

- [ ] **Step 1: Write failing regressions**

Test `/provider/` and `/operator/` redirect to `/admin/`, customer customer-only endpoints reject internal roles, first-login temporary-password state opens change-password flow, and no legacy console bundle exposes a route.

- [ ] **Step 2: Run RED, implement, and run GREEN**

Implement 302 compatibility redirects, Android forced-password-change route, and retained server permission guards. Run focused API/Android tests then all API, all admin builds, Android unit/build, and `git diff --check`.

- [ ] **Step 3: Commit**

Commit: `git commit -m "feat: migrate internal access to unified admin"`

## Plan Review

Task 1 establishes server enforcement; Task 2 creates secure customer credentials; Task 3 provides encrypted model selection; Task 4 supplies one Chinese management product; Task 5 preserves compatibility and verifies Android/customer boundaries. No task exposes model keys or customer raw data. Every task starts RED, ends GREEN, and has a separate review checkpoint.
