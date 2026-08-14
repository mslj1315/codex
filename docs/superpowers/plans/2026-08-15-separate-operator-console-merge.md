# Separate Operator Console Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebase the restaurant content-planning branch onto current `main` while keeping the service-provider and internal-operator consoles as separate applications with separate data boundaries.

**Architecture:** `apps/provider-console` remains the provider-facing application introduced on `main`; the existing operator template/rule console moves to `apps/operator-console`. The API retains separate provider and operator authentication/routes and serves only the configured internal operator static bundle through `OPERATOR_CONSOLE_DIST_DIR`.

**Tech Stack:** Git merge, TypeScript, React, Vite, Fastify, Vitest, Gradle/Kotlin where the Android SDK is available.

---

### Task 1: Move The Internal Operator Console Before The Merge

**Files:**
- Move: `apps/provider-console/` operator-console source, tests, package metadata, and Vite configuration to `apps/operator-console/`
- Modify: `.env.example`, `services/api/src/server.ts`, `services/api/test/operator-console-static.test.ts`, `docs/operations/operator-content-console.md`

- [ ] **Step 1: Write failing path-isolation tests**

Assert the operator static-serving test uses an `apps/operator-console/dist` fixture and assert package metadata identifies the application as `operator-console`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `cd services/api; npm test -- --run test/operator-console-static.test.ts`

Expected: FAIL because the internal console still occupies the provider application path.

- [ ] **Step 3: Move and rewire the internal console**

Move the complete current operator React/Vite application, change only its application name and documented build path, and preserve fixed same-origin operator request allowlists. Update API static-serving configuration to reference the independent path without changing operator API routes.

- [ ] **Step 4: Verify GREEN and commit**

Run the focused API test plus `npm test`, `npm run typecheck`, and `npm run build` in `apps/operator-console`.

Commit: `refactor: separate operator console application`

### Task 2: Merge Current Main And Preserve Both Control Planes

**Files:**
- Resolve: merge-conflicted root/API/Android/provider-console files
- Preserve: `apps/provider-console/` from `origin/main`, `apps/operator-console/` from Task 1

- [ ] **Step 1: Create merge-conflict regression coverage**

Add focused API/server or console tests proving provider-console configuration does not expose operator routes/content and operator-console configuration still serves only the internal static bundle.

- [ ] **Step 2: Run the focused test and verify RED**

Run the focused API test before completing the conflict-resolution wiring.

- [ ] **Step 3: Merge and resolve one boundary at a time**

Merge `origin/main`; retain its provider identity, provider feedback routes, provider static bundle, Android authenticated workspace, and import infrastructure. Preserve restaurant content routes, model providers, Douyin connection persistence, storyboard routes, and operator routes. Reconcile shared server registration and package dependencies without replacing either authentication boundary.

- [ ] **Step 4: Verify GREEN and commit the merge**

Run API full tests/typecheck, provider-console tests/typecheck/build, operator-console tests/typecheck/build, and Android regression when the SDK is available. Record any unavailable environment accurately.

Commit: merge commit from `origin/main`.

### Task 3: Boundary And Release Verification

**Files:**
- Test: affected API, provider-console, operator-console, Android, and migration suites

- [ ] **Step 1: Verify isolation searches**

Search provider-console runtime code for operator-content paths and operator-console runtime code for provider feedback/customer paths. Confirm only server-side configuration references model keys and storage signer credentials.

- [ ] **Step 2: Run final verification**

Run `git diff --check`, full API suite/typecheck, both console suites/typechecks/builds, and real PostgreSQL gates when `REAL_POSTGRES_TEST_URL` is configured.

- [ ] **Step 3: Push the resolved branch**

Push the merge result to the already-open PR; do not merge it into `main` or deploy it.
