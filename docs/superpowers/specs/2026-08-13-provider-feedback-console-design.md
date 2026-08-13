# Provider Feedback Console Design

## Goal

Add a browser-based, service-provider-only feedback console that lets an
authorized provider assess customer adoption and operational outcomes without
accessing a restaurant POS or raw customer business data. The first release is
strictly read-only. It shows the existing aggregate feedback projection and
keeps metric catalog publication in the existing controlled CLI.

## Scope

The new application lives at `apps/provider-console` and uses React, Vite, and
TypeScript. Its production assets are served from the API's same origin at
`/provider/`.

The console includes:

- Login, silent session restoration, token refresh, and logout.
- Server-derived provider capabilities.
- A provider-feedback list with activity/readiness filters and cursor paging.
- A current-page `enterpriseId` / `storeId` text filter.
- Loading, empty, filtered-empty, network-failure, authentication-failure, and
  provider-role-denied states.
- A role-gated informational catalog panel for `metric_catalog_operator` that
  states catalog changes remain in the controlled CLI.

The console does not include metric catalog editing, publishing, customer
notes, follow-up status, user administration, customer display-name editing,
cross-page text search, arbitrary report queries, or any restaurant-system
integration.

## Deployment And Session Model

The API and console are same-origin. The API serves the Vite production build
under `/provider/`; the production console never makes a credentialed cross-
origin request and no separate console port is exposed in Compose.

The existing JSON authentication routes remain the Android contract. New
provider-browser authentication routes use a distinct `/v1/provider-auth/`
prefix:

| Route | Request | Result |
| --- | --- | --- |
| `POST /login` | `loginName`, `password` | Creates a normal auth session, sets a refresh cookie, and returns an access token plus account/capabilities. |
| `POST /refresh` | Cookie only | Rotates the refresh session/cookie and returns a new access token plus account/capabilities. |
| `POST /logout` | Bearer access token plus cookie | Revokes the current session and clears the refresh cookie. |

The refresh cookie has `HttpOnly`, `Secure`, `SameSite=Strict`, and
`Path=/v1/provider-auth/`. Its value is never placed in a React state object,
browser storage, URL, log, or error message. The access token is held in memory
only. A page reload silently calls `/v1/provider-auth/refresh`; a successful
response recreates the in-memory access token, while a failure returns to the
login page.

Every provider-browser authentication request carries
`X-Provider-Console-Request: 1`. The provider-browser routes reject a missing
or invalid marker with a neutral 403 response. The API does not enable CORS for
these routes, so a third-party browser origin cannot send this non-simple
request header and read or use the cookie-backed response. This supplements the
strict same-site cookie policy for refresh and logout requests.

`Secure` means the production console requires HTTPS. Local development may use
an explicit development-only cookie configuration and a Vite same-origin API
proxy. Those settings are documented and tested so they cannot silently weaken
production cookies or add production CORS behavior.

## Authorization

The server computes the capabilities returned to the console from the
authenticated account's enabled `service_operator_roles`; the browser does not
infer roles from account names, store memberships, or token payloads.

- `provider_feedback_viewer` permits the feedback console to call the existing
  `GET /v1/provider-feedback/stores` projection.
- `metric_catalog_operator` only permits the first-release catalog information
  panel. It does not add a Web mutation route.
- The roles are independent. Either, both, or neither role may be granted.
- An account with neither service-provider role receives an explicit no-access
  page after successful login. It receives no feedback data and no store route
  access.

The existing provider-feedback route remains the data boundary. It continues to
enforce `provider_feedback_viewer` on every request even when the UI has already
received a capability response.

## Customer Feedback Workbench

The default page for an account with `provider_feedback_viewer` is Customer
Feedback. It requests the first page of the existing projection without filters.
It uses a conservative limit within the server's current 1-100 range.

Server-side filters use the existing request parameters only:

- Activity: all, `active`, `stale`, or `inactive`.
- Readiness: all, `ready`, `incomplete`, or `unavailable`.

Changing either filter resets the cursor and list before requesting a fresh
first page. The UI treats `nextCursor` as opaque and sends it unchanged only to
load the next page. It does not decode, synthesize, or alter cursors.

The current loaded page has a local, case-insensitive text filter over only
`enterpriseId` and `storeId`. This does not trigger a request and does not claim
to search customers outside the loaded page.

Each result displays only values already present in `ProviderFeedbackRow`:

- `enterpriseId` and `storeId`.
- Last successful import and last confirmation timestamps.
- Activity and readiness state.
- Missing-metric count.
- Deterministic diagnostic count.
- Action-card status counts.
- Verification-outcome counts.

The console must never render or fetch raw imports, fact values, metric values,
file names, file checksums, object keys, diagnostic evidence, action-card title
or content, execution note, customer contact data, provider notes, or follow-up
state. The view model may reserve presentation slots for future customer display
names, store aliases, and provider notes, but this release adds no fields or
writes for them and renders identifiers only.

## UI States And Error Behavior

- **Restoring:** a full-page loading state runs while a refresh-cookie attempt
  is in progress.
- **Login failure:** the UI presents one neutral authentication message and
  never distinguishes unknown accounts from invalid passwords.
- **No provider role:** the user remains authenticated but sees a no-access
  explanation and logout action.
- **Feedback loading:** a stable table/skeleton area prevents layout shift.
- **No customer data:** distinguishes an empty unfiltered projection from a
  filter that matches no loaded/current results.
- **401 feedback response:** the client performs one serialized provider-cookie
  refresh, retries the original request once with the replacement access token,
  and then returns to login if refresh/retry fails.
- **403 feedback response:** the user remains logged in, sees the no-feedback-
  permission state, and the client does not refresh repeatedly.
- **Network or 5xx response:** the client exposes a neutral retry command and
  never displays API response bodies or server exception text.

Logout sends the current bearer token when available, clears in-memory state in
all cases, and navigates to the login page. The API always clears the refresh
cookie whether or not the bearer token is still valid, preventing an unusable
browser session from persisting.

## API And Static Asset Boundaries

The API gains only the provider-browser session endpoints and same-origin static
asset registration. It does not add a broad browser proxy, CORS exception,
database credential path, or service-provider store context.

Static serving protects API routes from being replaced by the Vite fallback. A
direct `/provider/...` navigation returns the SPA entry document, while unknown
`/v1/...` routes continue to return API 404 behavior. Development serving stays
outside production API behavior.

## Testing And Verification

API tests cover:

- Cookie attributes, refresh rotation, cookie clearing, and production HTTPS
  cookie policy.
- Required provider-browser request marker, no-CORS behavior, and a rejected
  cross-origin-equivalent browser request.
- Browser login/refresh/logout response shape without refresh-token leakage.
- Capability combinations, no-role behavior, and independent role boundaries.
- Existing Android JSON login/refresh/logout compatibility.
- Static asset and `/provider/` fallback routing without intercepting `/v1/`.

Console tests cover:

- Login and silent restoration.
- One serialized 401 refresh/retry and 403 no-refresh behavior.
- Logout state clearing.
- Default list, server filters, current-page text filter, empty states, and
  opaque cursor pagination.
- Role-gated feedback/catalog panels.
- Explicit absence of sensitive projection fields from components and network
  mapping.

Final verification runs API tests/typecheck/audit, console tests/build, Android
tests/build regression, default and maintenance Compose validation, and
`git diff --check`.
