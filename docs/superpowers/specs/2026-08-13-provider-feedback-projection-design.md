# Provider Feedback Projection Design

## Goal

Let an authorized service-provider account understand whether each customer
scope is using the independent restaurant-operations product and whether that
usage is producing an operational feedback loop. The feature is a purpose-built
aggregate read model, not a cross-tenant form of the store API.

## Selected Approach

The API computes a real-time aggregate projection from existing import,
confirmation, readiness, diagnostic, and action-card records. The endpoint is
protected by the independent `provider_feedback_viewer` service role.

This is selected over a materialized feedback table because the current product
does not need delayed or precomputed reporting, and a derived table would add
reconciliation and freshness responsibilities without improving the privacy
boundary. Reusing store routes is rejected because their detail contracts may
contain business values, evidence, or operator-authored content.

## Authorization And Scope

`GET /v1/provider-feedback/stores` requires a valid bearer access token and an
enabled `provider_feedback_viewer` row for the authenticated account. The
service role is global and remains separate from `metric_catalog_operator` and
from store memberships.

The endpoint returns all customer scopes represented by its aggregate sources;
the caller does not send enterprise or store identifiers to select a scope. A
feedback viewer does not gain permission to call `/v1/stores/:storeId/...`.
Missing or invalid authentication receives the existing neutral 401 response.
A valid account without this role receives a neutral 403 response.

## Response Contract

The endpoint returns a bounded page:

```json
{
  "items": [
    {
      "enterpriseId": "ent_demo",
      "storeId": "store_demo",
      "lastSuccessfulImportAt": "2026-08-13T01:00:00.000Z",
      "lastConfirmedAt": "2026-08-13T01:10:00.000Z",
      "activityState": "active",
      "readinessState": "ready",
      "missingMetricCount": 0,
      "diagnosticCounts": { "revenue_decline": 1 },
      "actionCardStatusCounts": { "in_progress": 1 },
      "verificationOutcomeCounts": { "improved": 1 },
      "lastCoverageAt": "2026-08-13T01:10:00.000Z"
    }
  ],
  "nextCursor": null
}
```

`enterpriseId` and `storeId` are deliberately returned as stable support
references. They allow the provider to identify a customer scope for follow-up,
but names, contacts, and any personal information remain out of scope.

Every nullable timestamp is `null` when no corresponding record exists.
`activityState` is one of `active`, `stale`, or `inactive`, calculated from the
latest successful import using a server-owned 30-day freshness threshold.
`readinessState` is `ready`, `incomplete`, or `unavailable`; it summarizes the
latest confirmed coverage and never returns metric values or metric keys.
`lastCoverageAt` is the latest confirmed fact timestamp used for the readiness
summary. Counts contain only predeclared diagnostic kinds, action-card statuses,
and verification outcomes observed for the scope.

The response never contains raw import or fact data, file metadata, object
storage identifiers, source candidates, checksums, diagnostic evidence,
action-card title/action/execution-note text, verification metric values,
account identity data, sessions, or tokens.

## Query Behavior

The API accepts only these query parameters:

- `limit`, an integer from 1 through 100, defaulting to 50;
- `cursor`, an opaque cursor issued by a prior response;
- `activityState`, optionally `active`, `stale`, or `inactive`;
- `readinessState`, optionally `ready`, `incomplete`, or `unavailable`.

Rows are sorted deterministically by latest successful import descending,
then `enterpriseId`, then `storeId`. The opaque cursor carries only the sort
position and is validated strictly. The server applies all filters before the
page limit and requests one extra row to determine `nextCursor`. There is no
arbitrary range query, metric query, export, store-detail endpoint, or
impersonation parameter.

## Aggregation

The projection considers every `(enterprise_id, store_id)` appearing in
`import_batches`, `fact_versions`, `diagnostic_runs`, or `action_cards`.
For each scope it calculates:

- latest confirmed import batch timestamp and latest fact confirmation;
- readiness from the current published readiness metric definitions versus the
  latest confirmed coverage, reporting only its state and missing count;
- diagnostic-run counts grouped by immutable `kind`;
- action-card counts grouped by their fixed lifecycle status;
- non-null verification-outcome counts grouped by their stored outcome token.

The implementation uses grouped subqueries or CTEs rather than per-row
follow-up queries. A read-only repeatable-read transaction ensures all aggregate
components of one page use the same database snapshot.

## Auditing And Errors

Each successful or denied feedback access emits one structured audit log entry
containing the request ID, authenticated account ID when available, fixed role
name, requested filter categories, page limit, and returned count. Logs do not
contain raw query cursors, data values, response rows, credentials, or tokens.

Invalid query parameters return the established typed 422 response. Internal
database failures preserve the existing neutral server-error boundary and are
logged through Fastify without serializing database messages.

## Testing

Tests prove role separation, neutral authentication and authorization results,
and that a feedback viewer cannot access a store route. They seed multiple
scopes and assert real-time aggregate values, 30-day activity boundaries,
readiness summaries, status/outcome grouping, deterministic pagination, and
strict filter/cursor validation. Privacy tests assert an exact allowed response
shape and seed sentinel values for every excluded business or authentication
field to prove none reaches JSON or audit logs. A transaction-sequence test
asserts repeatable-read, read-only snapshot creation and cleanup.

## Scope Boundaries

This increment implements only the API projection. It does not add a provider
web console, metric-catalog UI, customer names or contacts, exports, personal
data retention policy, per-metric dashboards, new diagnostic rules, POS or
platform integrations, or Android provider screens.
