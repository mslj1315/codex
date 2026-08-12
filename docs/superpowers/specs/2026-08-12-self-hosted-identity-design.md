# Self-Hosted Identity And Authorization Design

## Goal

Replace the API's fixed trusted development context with a self-hosted identity
boundary suitable for the independent restaurant operations product. A caller
must authenticate as an account; the server, rather than the client, derives
the enterprise, store, and actor context used by import and operations routes.

This increment deliberately does not integrate a third-party identity provider,
provide public registration, or expose a service-operator web administration
surface.

## Selected Approach

The API owns account credentials, sessions, memberships, and authorization.
It issues a short-lived signed access token plus a rotatable refresh token.
This keeps the initial local/independent deployment self-contained while still
allowing server-side session revocation and membership changes to take effect.

Three alternatives were considered:

1. Signed access tokens with database-backed refresh sessions, selected. It
   gives low-overhead request authentication, explicit logout/revocation, and
   does not require an external service.
2. Opaque database sessions for every request. This simplifies token parsing but
   turns all authorization into a session lookup and does not improve the
   already-required membership lookup.
3. OIDC, enterprise WeChat, or SMS login. These are viable later adapters but
   require provider credentials, redirect/phone policies, and external runtime
   dependencies that are outside the independent P0 scope.

## Data Model

Migration `011_identity.sql` introduces only identity-owned tables. Existing
business rows retain their composite `enterprise_id` and `store_id` isolation;
this increment does not rewrite their history.

- `accounts`: opaque ID, unique normalized login name, display name, password
  hash, enabled state, and timestamps.
- `account_sessions`: opaque ID, account ID, SHA-256 refresh-token hash,
  expiry, revocation timestamp, and timestamps. The raw refresh token is never
  stored.
- `store_memberships`: account ID, enterprise ID, store ID, role
  (`owner` or `operator`), enabled state, and timestamps. The composite scope
  is unique per account.
- `service_operator_roles`: account ID, global role
  (`metric_catalog_operator` or `provider_feedback_viewer`), enabled state,
  and timestamps. It is separate from a store membership and cannot be inferred
  from one.

The initial role set is deliberately small. `owner` and `operator` may operate
the store routes that currently exist. `metric_catalog_operator` authorizes
future service-provider catalog management, and `provider_feedback_viewer`
authorizes only the provider feedback projection described below. Neither role
grants store membership or access to a store-scoped business route. There are no
employee hierarchy, cross-enterprise customer-management, or billing roles in
this increment.

## Credentials And Tokens

Passwords are accepted only over the deployment's TLS boundary and stored using
Node's `scrypt` with a unique random salt and a serialized parameter/version
prefix. Password comparison uses a constant-time comparison after derivation.

`AUTH_TOKEN_SECRET` is a mandatory high-entropy environment secret outside
development mode. Access tokens are compact HMAC-SHA-256 tokens containing:

- token version;
- account ID (`sub`);
- session ID (`sid`);
- issued-at and expiry timestamps;
- random token ID (`jti`).

They expire after 15 minutes. They contain no enterprise ID, store ID, role,
login name, password data, or service-operator privilege. Refresh tokens are
32 random bytes encoded for transport, expire after 30 days, and are rotated on
every successful refresh. Rotation revokes the prior session before creating a
replacement session. Logout revokes the current session.

An access-token request still checks that its session is active and that the
account is enabled. This means logout, password/session revocation, and account
disable take effect before the 15-minute access-token expiry. Authentication
failures always return the same neutral `401` response and are logged without
credentials or raw tokens.

## API Boundary

The following unauthenticated endpoints are added under `/v1/auth`:

- `POST /login` accepts login name and password and returns an access token,
  refresh token, expiry, and public account identity.
- `POST /refresh` accepts a refresh token, rotates it, and returns a new token
  pair.
- `POST /logout` requires an access token and revokes its session.
- `GET /me/stores` requires an access token and returns only enabled stores for
  the account: enterprise ID, store ID, and membership role.

All existing `/v1/stores/:storeId/...` routes continue to receive
`TrustedContext`, but their production resolver is replaced by an authenticated
resolver. It validates the bearer access token, confirms the active session and
account, and queries an enabled membership matching the route's store ID. The
resolver supplies the matching enterprise ID and account ID as `actorId`.
The URL store ID is never enough to grant access, and a caller cannot provide
an enterprise ID or actor ID in headers or JSON to select another scope.

`developmentContextResolver` and `localContainerContextResolver` remain
available only when their explicit development flags are true. A production
server with a database must fail startup without `AUTH_TOKEN_SECRET`; it must
not silently fall back to the demo context.

## Provisioning And Operator Boundary

There is no anonymous sign-up. A dedicated `provision-account` CLI reads its
credentials from explicit environment variables, creates or updates an account,
and grants one store membership and optionally one service-operator role in a
transaction. It emits a neutral aggregate result and never writes the password,
password hash, refresh token, or token secret to stdout/stderr.

The existing metric-catalog publish CLI remains the only provider management
entry point in this increment. It is deployed as an operator-controlled process
with database credentials. A later authenticated provider web console must
authenticate an account and verify `metric_catalog_operator` before invoking
the existing draft/publish lifecycle; it must not gain direct database mutation
paths.

## Provider Feedback Projection

The future provider backend may show customer usage and outcome feedback, but
only through a purpose-built read model protected by
`provider_feedback_viewer`. It is not a cross-tenant version of the store API
and it does not allow a provider account to fetch a store's imports, facts,
files, diagnostic evidence, action-card text, execution notes, or verification
metric values.

Each provider-feedback row is keyed by the enterprise/store scope already used
by the product and contains only the minimum operational feedback needed to
understand adoption and effectiveness:

- stable customer scope reference for support follow-up;
- last successful import/confirmation timestamp and recent activity state;
- current readiness state and missing-metric count, not the metric values;
- deterministic diagnostic availability/count by rule kind, not evidence;
- action-card status counts and verification-outcome counts;
- coverage timestamps used to identify stale or incomplete product usage.

The feedback projection excludes original filenames and bytes, object keys,
checksums, raw fact values and money amounts, candidate values, diagnostic
evidence, action titles/actions, execution notes, account login names, refresh
sessions, and authentication material. Its API permits bounded pagination and
server-selected aggregate filters only; it has no arbitrary SQL, per-metric
value, export, or cross-role impersonation capability.

`provider_feedback_viewer` is independent from `metric_catalog_operator`, so a
service provider can be granted one capability without acquiring the other. All
feedback reads emit an auditable account ID, request ID, role, and selected
scope/filter category, never raw token or customer content. A later decision on
customer-facing privacy notices, retention, or expanded support identity is
required before this projection can include names or personal contact data.

## Android Boundary

The Android app gains a login/session repository, encrypted-at-rest refresh
token storage, a login screen, and a store selector. It attaches only the
access token as a bearer credential. It obtains available stores from
`/v1/auth/me/stores`; it no longer assumes `store_demo` outside explicit debug
local-demo mode. An expired access token attempts one serialized refresh, then
returns to login on failure. The app never stores a password after login and
does not parse tokens to decide store access.

Android local-demo continues to work without configured credentials so the
offline product demonstration remains usable. Debug API mode uses the real
login flow. Release configuration has no default API base URL or demo bypass.

## Errors, Privacy, And Auditing

- Invalid/missing/expired/revoked access token, disabled account, and invalid
  credentials return a common `401 { "error": "Authentication required" }`.
- A valid account without the requested store membership returns `403` without
  revealing whether that store exists.
- Login-name conflicts and provisioning failures are stable, non-secret CLI
  errors; normal HTTP login does not reveal whether an account exists.
- Structured logs may include event type, request ID, account ID, and requested
  store ID after authentication. Provider feedback reads additionally record the
  service role and selected aggregate filter category. Logs never include
  passwords, hashes, access tokens, refresh tokens, authorization headers, or
  `AUTH_TOKEN_SECRET`.
- Rate limiting, password-reset delivery, MFA, SSO, and organization self-signup
  are deferred until there is a production identity-provider or notification
  decision.

## Migration And Compatibility

Existing import/operations data remains reachable only through explicit
development context until accounts and memberships are provisioned. The new
tables do not impose foreign keys onto legacy free-form enterprise/store IDs,
which preserves the current independent data model. The provisioning CLI creates
memberships using the same IDs already present in business rows.

Compose development continues to set `LOCAL_CONTAINER_DEVELOPMENT_MODE=true`.
Production deployment removes that flag, provides `AUTH_TOKEN_SECRET`, runs the
migration, provisions accounts explicitly, and uses authenticated requests.

## Verification

API tests cover credential hashing/verification, token expiry/signature/version
validation, refresh rotation and replay rejection, logout and account disable,
membership isolation, service-operator separation, no production demo fallback,
and provision CLI privacy/transaction cleanup. Provider feedback tests prove
that its role is required, its response contains only the approved aggregate
shape, and that a feedback viewer cannot call a store route. Route tests prove a
token for one store cannot access a second store or forge enterprise/actor
context.

Android tests cover login validation, encrypted refresh-token lifecycle, one
refresh retry, logout cleanup, store selection, unauthenticated error handling,
and local-demo isolation. Full API and Android unit/build verification remains
required. A later real-device pass must verify encrypted storage and process
restoration.
