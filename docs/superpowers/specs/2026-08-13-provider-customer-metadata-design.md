# Provider Customer Metadata Design

## Goal

Let an authorized service-provider operator attach a readable customer alias and
an internal provider note to a customer scope already visible in the provider
feedback console. This improves support follow-up without exposing customer raw
data, changing Android contracts, or turning the aggregate feedback projection
into a writable business-data interface.

## Selected Approach

Provider-owned customer metadata is a separate domain from provider feedback.
A new table and repository store one optional metadata record per
`(enterprise_id, store_id)`. A new provider-customer list endpoint composes the
existing aggregate feedback page with this metadata for the console. The
existing `GET /v1/provider-feedback/stores` endpoint and its exact privacy
contract remain unchanged.

Metadata writes use a dedicated route, an independent editor role, optimistic
version checks, and content-free audit logs. This is selected over adding writes
to the feedback route because `provider_feedback_viewer` is an established
read-only capability. Browser-local storage is rejected because aliases and
notes must be durable, shared across authorized provider accounts, and
auditable.

## Scope

This increment includes:

- One optional customer alias and one optional provider note per existing
  customer scope.
- A composed, paginated provider-customer read endpoint.
- Create, replace, and clear behavior protected by optimistic concurrency.
- A new `provider_customer_metadata_editor` service-operator role.
- Read and edit presentation in the existing provider console.
- Structured read/write auditing that never contains alias or note text.

It does not include contacts, phone numbers, account owners, assignees,
follow-up states, reminders, attachments, rich text, note history, exports,
customer self-service, Android presentation, arbitrary customer creation, or
restaurant-system integration.

## Data Model

A new `provider_customer_metadata` table has:

| Column | Contract |
| --- | --- |
| `enterprise_id` | Existing stable customer-scope identifier. |
| `store_id` | Existing stable customer-scope identifier. |
| `customer_alias` | Nullable plain text, at most 120 Unicode code points. |
| `provider_note` | Nullable plain text, at most 2,000 Unicode code points. |
| `version` | Positive integer, starting at 1 and incremented on every successful replacement. |
| `updated_by_account_id` | Provider account that performed the latest successful write. |
| `created_at` | Server-owned creation timestamp. |
| `updated_at` | Server-owned latest-write timestamp. |

The composite primary key is `(enterprise_id, store_id)`. The account reference
uses the existing `accounts` table. Metadata is provider-owned operational
context; it is not copied into import batches, facts, diagnostics, action cards,
store memberships, Android models, or metric catalogs.

Input is normalized before validation. Leading and trailing whitespace is
removed, line endings are normalized, and an empty result becomes `null`.
Control characters other than newline and tab are rejected. The API treats the
limits as Unicode code-point limits rather than JavaScript UTF-16 unit limits.
HTML and Markdown are not interpreted; the console renders both values as
plain text.

If both normalized fields are `null`, the operation clears the metadata record.
Clearing an existing record requires its current version. Clearing a missing
record with `expectedVersion: null` succeeds idempotently and returns
`metadata: null`.

## Authorization

The existing roles keep their current meanings:

- `provider_feedback_viewer` may read the composed provider-customer list and
  existing metadata for scopes in that list.
- `metric_catalog_operator` gains no customer metadata access.
- `provider_customer_metadata_editor` is a new independent capability, but it
  grants no customer visibility by itself.

A write requires both `provider_feedback_viewer` and
`provider_customer_metadata_editor` on the authenticated account. Requiring
both roles prevents an editor-only account from probing or creating arbitrary
customer scopes. The server checks both roles for every write; the browser
capability state only controls presentation and is never authoritative.

Provider-browser login and refresh responses add
`providerCustomerMetadataEditor` to their capabilities object. This change is
limited to `/v1/provider-auth/*`. Existing Android `/v1/auth/*` response bodies,
refresh-token behavior, store membership rules, and store API authorization do
not change.

## Customer Scope Boundary

Metadata may be written only for a scope currently represented by the same
aggregate sources used by the provider feedback projection: import batches,
fact versions, diagnostic runs, or action cards. The server validates scope
existence after authorization and before mutation.

A metadata row is never a source of customer visibility. It cannot create a new
customer in the console, keep a removed scope visible, or grant access to a
store route. The provider list starts from the feedback projection and only
then batch-loads metadata for the returned page.

This increment continues the current single-provider operational-domain model.
It does not claim organization-level isolation between multiple service
providers. Introducing multiple provider organizations requires a separate
tenant model and migration before metadata can be partitioned by provider.

## HTTP Contracts

### Composed Customer List

`GET /v1/provider-customers` requires `provider_feedback_viewer`. It accepts
exactly the existing feedback list query parameters: `limit`, `cursor`,
`activityState`, and `readinessState`. Filtering, ordering, page size, and the
opaque cursor remain based only on the aggregate feedback projection; aliases
and notes do not change page membership or ordering.

Each item keeps the domains visibly separate. `feedback` is the exact existing
`ProviderFeedbackRow` public mapping; the composed route does not independently
select, rename, or expand aggregate fields:

```json
{
  "items": [
    {
      "feedback": {
        "enterpriseId": "ent_demo",
        "storeId": "store_demo",
        "lastSuccessfulImportAt": "2026-08-13T01:00:00.000Z",
        "lastConfirmedAt": "2026-08-13T01:10:00.000Z",
        "activityState": "active",
        "readinessState": "ready",
        "missingMetricCount": 0,
        "diagnosticCounts": { "revenue_decline": 1 },
        "actionCardStatusCounts": { "in_progress": 1 },
        "verificationOutcomeCounts": { "effective": 1 },
        "lastCoverageAt": "2026-08-13T01:10:00.000Z"
      },
      "metadata": {
        "customerAlias": "North District Pilot Store",
        "providerNote": "Review data readiness during the next support call.",
        "version": 3,
        "updatedAt": "2026-08-13T02:00:00.000Z"
      }
    }
  ],
  "nextCursor": null
}
```

`metadata` is `null` when no metadata row exists. The read response does not
return `updatedByAccountId`; accountability remains in the database and audit
event rather than exposing account linkage in every list response. The server
batch-loads metadata for one feedback page and does not issue one query per
customer. Aggregate feedback and metadata are independent domains, so a single
cross-domain database snapshot is not required; a returned metadata `version`
is the authority for the next write.

### Replace Or Clear Metadata

`PUT /v1/provider-customers/:enterpriseId/:storeId/metadata` requires both
provider roles described above and the provider-console request marker. The
JSON body is exact and rejects unknown fields:

```json
{
  "customerAlias": "North District Pilot Store",
  "providerNote": "Review data readiness during the next support call.",
  "expectedVersion": 2
}
```

For initial creation, `expectedVersion` must be `null`. For replacement or
clear, it must equal the current positive integer version. A successful create
or replacement returns status 200 as `{ "metadata": { ... } }`, using the same
public metadata shape as the composed list. A successful clear returns status
200 with `{ "metadata": null }`.

The route uses the existing bearer access token. It does not use the refresh
cookie as authorization, does not enable CORS, and does not accept account IDs,
roles, customer names, contact data, or provider organization identifiers from
the client.

## Errors And Concurrency

- Missing or invalid authentication returns the existing neutral 401 response.
- A missing viewer role or editor role returns a neutral 403 metadata-access
  response without identifying which role is absent.
- An invalid identifier, unknown body key, invalid field type, disallowed
  character, excessive length, or invalid expected version returns the existing
  typed 422 response.
- A customer scope not represented by the feedback sources returns a neutral
  404 `Provider customer is not available` response.
- A stale or incorrect `expectedVersion` returns 409 with
  `Provider customer metadata has changed`; the response does not include the
  current note, alias, author, or version.
- Database and infrastructure failures return a neutral 500 boundary. Raw error
  text and submitted content never enter the response.

The console keeps the user's unsaved draft on 409, explains that the stored
record changed, and offers an explicit reload command. It does not silently
overwrite the newer value or automatically merge notes. Authentication failure
returns to login through the existing session client; a 403 keeps the session
and removes edit controls; network and 5xx failures provide a neutral retry.

## Console Behavior

The existing customer feedback workbench becomes the provider-customer
workbench and reads the composed endpoint. A customer alias, when present, is
the primary readable label; `enterpriseId` and `storeId` remain visible as
stable support references. The current-page text filter matches alias,
`enterpriseId`, and `storeId`, but never searches note text and never creates a
server request.

Accounts with both required roles receive explicit edit controls for the alias
and note. Accounts with only `provider_feedback_viewer` see the saved values as
read-only. The editor submits both fields as one versioned replacement, disables
duplicate submission, and updates the row only from the normalized server
response. Plain-text rendering prevents submitted markup from becoming active
content.

The console does not add a customer detail API, server-side alias search, note
history view, assignee workflow, follow-up state, or customer-contact surface.

## Auditing And Privacy

Each composed list request produces one best-effort structured
`provider_customer_list_access` event with request ID, authenticated account ID
when available, fixed role, filter-presence flags, parsed limit, outcome, and
returned count. It excludes cursors, customer identifiers, aliases, notes,
response rows, credentials, and errors.

Each mutation attempt produces one best-effort structured
`provider_customer_metadata_write` event with request ID, authenticated account
ID when available, enterprise ID, store ID, operation (`create`, `replace`, or
`clear` when known), expected version, resulting version when successful,
outcome, and fixed required-role names. It never records alias text, note text,
request bodies, credentials, cookies, tokens, database errors, or response
objects. Audit logging failure does not change the HTTP result.

Provider notes are provider-entered internal support context. The product does
not derive them from customer imports or solicit raw facts, files, action text,
contacts, or credentials. They are never returned by the original feedback
route, any store route, Android API, catalog API, health endpoint, or audit-log
payload.

## Testing And Verification

Database and repository tests cover migration application, composite-key
uniqueness, normalized nulls, Unicode code-point limits, clear behavior,
scope-existence checks, atomic version increments, stale-version conflicts, and
batch metadata reads without N+1 queries.

API tests cover:

- Exact role separation for viewer, editor, catalog operator, both required
  roles, disabled roles, and store membership.
- An editor-only account being unable to list, probe, create, replace, or clear
  customer metadata.
- The original `GET /v1/provider-feedback/stores` response remaining byte-shape
  compatible and free of metadata fields.
- Composed paging preserving the feedback cursor and filter behavior.
- Unknown-scope 404, validation 422, conflict 409, neutral 401/403/500, and
  provider-console marker enforcement on writes.
- Exact audit allowlists and sentinel alias/note text never appearing in logs,
  errors, the original feedback route, or store routes.
- Browser capability responses gaining only the provider metadata editor flag,
  while Android authentication tests remain unchanged.

Console tests cover alias-first display with identifiers retained, read-only and
editable role combinations, local alias/identifier filtering, plain-text
rendering, normalization response handling, duplicate-submit prevention,
successful create/replace/clear, 409 draft preservation and reload, and neutral
403/5xx behavior. Privacy fixtures continue to prove that raw imports, facts,
files, evidence, action content, execution notes, contacts, and authentication
data are not mapped or rendered.

Final verification runs the focused and full API suites, API typecheck and
high-severity audit, console tests/typecheck/production build, Android unit and
debug/release build regression, default and maintenance Compose validation,
migration tests, `git diff --check`, and a final privacy-field scan.

## Documentation State

The implementation increment updates `docs/architecture/current-gap-analysis.md`
only to record the already-completed provider console and this metadata
capability accurately. It does not use that correction as an opportunity for an
unrelated architecture rewrite.
