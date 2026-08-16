# Operator Content Console Operations

## Deployment

Build the console in `apps/operator-console` with `npm run build`.  Configure
the API process with `OPERATOR_CONSOLE_DIST_DIR` set to the absolute path of
the resulting `apps/operator-console/dist` directory.  The API then serves the
console and `/v1` endpoints from one HTTPS origin.

Do not deploy the Vite development server as the production console.  Its
proxy is only for local development.  It rewrites the proxied request origin
to the API origin so that the API's strict same-origin protection holds.

Keep TLS terminated at the API or preserve HTTPS end to end.  The API has
`trustProxy` disabled deliberately; it does not trust client-controlled
forwarded-protocol headers while comparing `Origin` with the direct request
scheme and host.

## Accounts, Sessions, And CSRF

Provision the initial internal account with the API working directory:

```powershell
$env:DATABASE_URL = 'postgresql://...'
$env:OPERATOR_ACCOUNT_ID = 'operator_admin'
$env:OPERATOR_PASSWORD = 'a-unique-password-of-at-least-12-characters'
npm run provision:operator
```

Only the server-side `operator_admin` role can use the console.  There is no
self-service registration, provider login, or Android authentication path for
these routes.  To rotate access, provision a separate replacement account,
validate its login, then disable the retired account:

```powershell
$env:OPERATOR_ACCOUNT_ID = 'retired_operator'
npm run disable:operator
```

Disabling revokes active sessions.  Sessions are opaque, expiring,
HttpOnly/SameSite cookies; the database stores only their hashes.  The console
keeps the CSRF value only in memory and sends it on each state-changing request.
Login, logout, and every content mutation require a same-origin request;
logout and content mutations also require the session-bound CSRF token.

Set `OPERATOR_COOKIE_SECURE=false` only for local HTTP development.  It defaults
to secure cookies in production.  Configure `OPERATOR_SESSION_TTL_SECONDS`
between 300 and 86400 seconds when the default eight-hour session is not
appropriate.

## Content Lifecycle

Templates and review rules are logical items with numbered versions:

1. Save a draft.
2. Publish the draft directly as the sole internal operator.
3. Edit a published item by creating its next draft version, then publish it.
4. Disable a published version when it must no longer participate in matching
   or rule selection.

The database guards permanently published and disabled history against direct
rewrite or deletion.  Every create, draft save, publish, and disable action is
recorded in append-only audit history.  Rule preview input is evaluated only
for the request and is not retained.

## Explicit Boundaries

This console does not expose customer drafts, raw Douyin reports, unconfirmed
feedback, training exports, provider data, Android data, passwords, session
secrets, model keys, POS integrations, video editing, rendering, or platform
publishing.  It sends requests only to the fixed same-origin operator API
allowlist.

## Verification Checklist

Run these checks before a release candidate:

```powershell
Set-Location services/api
npm test
npm run typecheck

Set-Location ../../apps/operator-console
npm test
npm run typecheck
npm run build
```

The API migration suite runs a PostgreSQL trigger-invariant integration test
only when `REAL_POSTGRES_TEST_URL` is set.  That URL must point to a dedicated,
disposable database, never the runtime `DATABASE_URL`.  Without it, Vitest
reports this test as skipped; a `pg-mem` structural test does not substitute
for executing PL/pgSQL triggers in PostgreSQL.

When an Android SDK is installed, run:

```powershell
.\gradlew.bat :apps:android:app:testDebugUnitTest --no-daemon
```

Do not create or change `local.properties` merely to make this check pass.
Record a missing SDK location as an environment limitation and retain the API
and Android contract tests as separate regression evidence.
