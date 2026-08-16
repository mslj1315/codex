# Simple Password Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce an 8-character upper/lower-case password policy for password changes and provide internal-admin self-service password change.

**Architecture:** `services/api/src/auth/credentials.ts` owns new-password acceptance. The existing authenticated change-password endpoint stays stable. The unified console calls it using its in-memory bearer and clears the local session after success.

**Tech Stack:** TypeScript, Fastify, bcryptjs, Vitest, React.

---

### Task 1: Central Password Validation

**Files:**
- Modify: `services/api/src/auth/credentials.ts`
- Modify: `services/api/src/auth/service.ts`
- Test: `services/api/test/auth-credentials.test.ts`
- Test: `services/api/test/auth-routes.test.ts`

- [ ] Write RED tests for `Abcdefg`, `abcdefgh`, and `ABCDEFGH` rejection plus `Abcdefgh` acceptance.
- [ ] Run `cd services/api; npm test -- --run test/auth-credentials.test.ts` and observe RED.
- [ ] Add one shared predicate requiring UTF-8 length 8..72 plus `/[A-Z]/` and `/[a-z]/`; use it from bcrypt hashing and password change.
- [ ] Run `cd services/api; npm test -- --run test/auth-credentials.test.ts test/auth-routes.test.ts` and typecheck.
- [ ] Commit only the scoped API files.

### Task 2: Unified Admin Password Change

**Files:**
- Modify: `apps/admin-console/src/api.ts`
- Modify: `apps/admin-console/src/app.tsx`
- Create: `apps/admin-console/src/account-security.tsx`
- Modify: `apps/admin-console/src/app.test.tsx`

- [ ] Write RED tests for account-security navigation, authenticated POST body, successful logout, and confirm mismatch without a request.
- [ ] Run `cd apps/admin-console; npm test -- --run src/app.test.tsx` and observe RED.
- [ ] Add a client API method and a self-service form. Client validation mirrors the service rule; success clears bearer/session; all errors are neutral.
- [ ] Run `npm test -- --run src/app.test.tsx`, `npm run typecheck`, and `npm run build` in `apps/admin-console`.
- [ ] Commit only scoped console files.

### Task 3: Review and Final Verification

- [ ] Specification review: exact simple rule, legacy-login compatibility, no secret persistence, neutral errors, and no customer-resource access.
- [ ] Quality review: current bearer only, success logout, failure/cancellation behavior, and focused test coverage.
- [ ] Run API full test/typecheck, console full test/typecheck/build, and `git diff --check`.
