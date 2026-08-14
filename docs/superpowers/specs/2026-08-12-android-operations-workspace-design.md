# Android Operations Workspace Design

## Goal

Expose the existing independent operations API in the Android workspace as a
dedicated bottom-navigation tab. The tab lets a store operator assess data
readiness, see a deterministic diagnosis when one is supported by confirmed
facts, and review the store's action cards.

The feature remains independent of POS, ERP, delivery-platform, or other
restaurant-system integrations. It does not invent operational conclusions in
the local demo experience.

## Navigation and Scope

Add an `OPERATIONS` entry to `WorkspaceTab`, placed after Home. Selecting it
renders `OperationsScreen` inside the existing `WorkspaceRoot` scaffold. It is
not an overlay and does not alter the import, diagnosis, task, video, message,
or profile flows.

The first scope is read-only:

- Load readiness, deterministic diagnostic, and action cards for one configured
  store and comparison range.
- Render action card title and lifecycle status.
- Render a verification summary only when the user chooses an existing action
  card and the API returns one.
- Do not create, update, complete, verify, or cancel action cards in this
  increment.

## Data Flow

`WorkspaceRoot` determines whether an independent API is available with the
existing `LocalImportApiRuntime` gate:

1. Debug builds with a non-blank local API base URL create `OperationsApi` and
   `HttpOperationsRepository` from the same Retrofit base URL as imports.
2. Release builds, and Debug builds without a URL, use an unavailable
   operations source. It returns a typed unavailable state; it does not create
   mock readiness, diagnoses, cards, or verification outcomes.
3. `OperationsViewModel` performs the three screen requests concurrently and
   commits them atomically only after all complete successfully.
4. The screen triggers the initial load for a fixed, explicit comparison range
   supplied by the workspace configuration. A manual refresh repeats that same
   query.

The UI only receives the public DTO mappings already defined by
`OperationsRepository`; batch IDs, object keys, request bodies, raw response
errors, and infrastructure configuration are never displayed.

## Screen States

The page is a vertically scrolling operational surface with full-width sections,
not nested page cards:

1. **Readiness**: shows comparison availability, confidence, and any missing
   metrics. When comparison is unavailable, diagnostics and verification remain
   visually secondary and explain that confirmed comparable facts are required.
2. **Deterministic diagnosis**: shows a concise supported diagnosis if one is
   returned; an explicit empty state if none is returned. Empty is not an error.
3. **Action cards**: lists current card title and status; selecting a card can
   reveal its read-only verification summary when available.
4. **Unavailable, loading, and failure**: unavailable configuration says the
   operations service is not configured; loading retains prior results; failure
   retains prior results and shows only the ViewModel's neutral error text.

No action-card status, verification conclusion, or diagnostic is synthesized by
the client.

## Error Handling

The screen treats `OperationsRequestException` as an expected service boundary.
Connection failures and other failures use the existing neutral ViewModel
messages. A failed refresh does not clear the prior complete screen snapshot.
Cancellation is allowed to propagate normally. The unavailable local source is
distinct from a network failure so release builds do not imply an attempted
connection.

## Testing

Add focused JVM tests for:

- workspace tab persistence and tab selection;
- unavailable source behavior and no fabricated operational data;
- screen state mapping for ready, no-diagnosis, loading, unavailable, and
  neutral-error cases;
- initial and manual refresh request arguments;
- verification-summary display only from the public repository contract.

Keep existing repository and ViewModel tests. Complete the Android Debug unit
suite, Debug APK build, Release APK build, and `git diff --check` before
submission.
