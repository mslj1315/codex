# Action Card Diagnostic Evidence Detail Design

## Goal

Let a user reviewing an action card read the immutable, public evidence snapshot
that created that card. The evidence must remain independent of later fact
imports and later diagnostic runs.

## Scope

This increment adds a store-scoped, read-only diagnostic-run detail endpoint
and an Android on-demand evidence section for linked action cards. It does not
add POS, ERP, ordering, delivery, platform, model, or external-system
integration.

## API Contract

Add `GET /v1/stores/:storeId/diagnostic-runs/:diagnosticRunId` to the existing
trusted-context import routes.

The repository reads `diagnostic_runs` and `diagnostic_evidence` using both the
trusted enterprise ID and store ID. A missing record and a record outside that
scope both result in the existing neutral `NotFoundError` response. The route
does not expose whether the ID exists in another enterprise or store.

The response is limited to the stored public diagnostic projection:

```ts
{
  id: string;
  kind: "revenue_decline";
  rangeStart: string;
  rangeEnd: string;
  priorRangeStart: string;
  priorRangeEnd: string;
  ruleVersion: string;
  confidence: "high" | "medium";
  createdAt: Date;
  evidence: [{ metricKey: "revenue"; currentValue: number; priorValue: number; changePercent: number }];
}
```

It never returns the snapshot hash, fact-version IDs, source batch IDs, source
candidate IDs, import file data, object keys, source locators, actor IDs, or
raw database errors.

## Repository and Service

`ImportRepository.getDiagnosticRun` accepts `{ id, enterpriseId, storeId }`.
It reads the scoped run first, throws `NotFoundError` when its row count is not
one, then reads evidence ordered by metric key and maps it to public numeric
fields. It does not recompute the rule or read `fact_values`.

`ImportService.getDiagnosticRun` passes the trusted context unchanged. The
route is read-only and has no persistence side effects. Existing diagnostic
creation and action-card endpoints remain unchanged.

## Android Experience

`OperationsApi` receives one `DiagnosticRunResponse`; its fields mirror only
the public API projection. `OperationsRepository` exposes
`loadDiagnosticRun(storeId, diagnosticRunId)` and maps it to a domain model.

When the user selects a linked action card, the view model requests its
diagnostic run alongside the existing verification summary request. The UI
shows the recorded rule version, confidence, current value, prior value, and
percentage change below that action card. It does not display the opaque run
ID or any internal provenance identifiers.

Manual cards have `diagnosticRunId == null`; selecting them clears any prior
diagnostic detail and makes no diagnostic-detail request. Selecting another
linked card replaces the previous detail. A diagnostic-detail request failure
leaves cards and verification summary intact, clears stale evidence, and
surfaces the existing neutral operations error state. No evidence is invented.

## Error Handling

The API reuses the existing validation/not-found error mapping. Android maps
HTTP and network failures through `OperationsRequestException`; it never shows
the server response body or raw exception message.

## Testing

API tests cover public field mapping, stable evidence ordering, cross-store
non-disclosure, no fact-table recomputation, and route shape without internal
identifiers. Android tests cover DTO/domain mapping, manual-card no-fetch,
linked-card fetch, selection replacement, stale-detail clearing, and neutral
failure behavior. The final gate runs the full API suite and typecheck, all
Android Debug unit tests and Debug/Release assembly, Compose config validation,
and an identifier/integration scope scan.
