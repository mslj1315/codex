# Android Reliable Operations Home Design

## Goal

Turn the authenticated Android app's existing Home tab into the store team's
daily entry point. It must show only conclusions grounded in the selected
store's most recently confirmed operational data and direct the team to import
when that data is absent or stale.

## Selected Approach

The existing `HOME` workspace tab is upgraded in place. In a remote authenticated
workspace it loads a server-derived latest confirmed period, then reads the
existing readiness, deterministic diagnostic, action-card, and verification
contracts for exactly that period and selected store. The local demo Home tab
remains explicitly local and unchanged.

This is selected over a new tab because Home is already the daily starting
point. It is selected over making the existing Operations tab the start screen
because Operations remains the deeper review surface; Home must first make data
freshness and the next operator action obvious.

## Scope And Trust Boundary

The remote Home page receives the selected `StoreMembership` from
`SessionViewModel`; it uses that `storeId` as the only client-visible scope. The
server continues to derive enterprise and actor context from the access token
and membership. No header, local preference, or UI parameter may select another
store.

The Home page does not use `store_demo`, a fixed historical date range, local
demo summaries, or unconfirmed import candidates in remote mode. It does not
calculate its own diagnosis, readiness score, action outcome, or financial
fact. Every operational conclusion displayed in remote mode comes from an
existing public API response.

## Data Flow

Add a narrow read-only Home repository contract:

1. Read the selected store's latest confirmed period from a new aggregate-only
   store endpoint. It returns only `rangeStart`, `rangeEnd`, and `confirmedAt`;
   it returns an explicit empty result when the store has no confirmed fact
   version.
2. When a period exists, concurrently fetch readiness, deterministic diagnosis,
   and action cards for that same range. Fetch an action-card verification
   summary only after the operator selects one card, as the existing Operations
   flow does.
3. Compute data freshness from the server-returned `confirmedAt` against the
   device's current time. Confirmation at or within 30 days is current; older
   confirmation is stale. There is no client-controlled threshold.
4. When there is no confirmed period, do not call readiness, diagnosis, action,
   or verification APIs. Return a typed `NoConfirmedData` state instead.

The authenticated Retrofit client still owns bearer attachment and one serialized
refresh attempt. A terminal 401 invalidates the session through the existing
callback; the Home state itself never stores or interprets tokens.

## Home States And Layout

Remote Home uses a scrolling, full-width operational layout rather than nested
dashboard cards.

### Reliable Snapshot

When a current confirmed period exists, the top section shows the confirmed date
and period. It then presents, in order:

1. data readiness summary and any missing metric labels already supplied by the
   public readiness DTO;
2. concise deterministic diagnosis, or the explicit “no supported diagnosis”
   state;
3. current action-card count/statuses and the highest-priority current action;
4. selected-card verification only when the operator asks to view it.

The primary action is `View operations`; a secondary action opens data import.

### Data Needs Update

When no confirmed period exists, or the latest confirmation is older than 30
days, a status section explains whether confirmation is missing or out of date.
`Import operating data` becomes the primary action and opens the existing import
flow. If a stale period exists, its last reliable snapshot remains visible below
the status section and is labelled as older confirmed data; it is never presented
as current.

### Loading, Failure, And Unavailable

Initial loading shows a bounded progress state. Refresh retains the previous
complete snapshot while loading. A failed refresh retains that snapshot and
shows a neutral retry action; it never replaces reliable data with an error-only
screen. API configuration unavailable is distinct from a network failure and
uses the existing unavailable-state behavior. A terminal authentication failure
returns through the existing session invalidation path. Store access rejection
does not reveal whether another store exists and provides only a neutral access
message plus a store-switch action.

## API Addition

Add `GET /v1/stores/:storeId/operations/latest-confirmed-period`. It accepts no
date query and is protected by the existing authenticated store-context resolver.
It returns either:

```json
{ "period": { "rangeStart": "2026-08-01", "rangeEnd": "2026-08-07", "confirmedAt": "2026-08-08T03:00:00.000Z" } }
```

or:

```json
{ "period": null }
```

It reads the latest confirmed fact version within the trusted store scope,
selecting its confirmed batch range. It never returns fact values, identifiers,
candidate data, source/batch IDs, filenames, object keys, checksums, actor IDs,
or timestamps outside the approved period/confirmation fields.

## Testing

API tests cover trusted-scope isolation, null result, newest confirmation
selection, public JSON shape, and raw-value/provenance sentinel exclusion.
Android JVM tests cover current/stale/missing classification at the exact 30-day
boundary, no follow-up requests when no confirmed period exists, one fixed range
for all follow-up calls, refresh snapshot retention, neutral errors, and import
navigation from stale/missing states. Compose tests cover current, stale,
missing, loading, retained failure, and unavailable state rendering. Existing
authenticated client tests continue to prove session invalidation on terminal
401.

Complete API tests/typecheck and Android Debug unit tests, Debug/Release builds,
emulator instrumentation, Compose configuration, and whitespace checks before
submission.

## Out Of Scope

This increment does not create a provider Android screen, an operations web
console, offline business-fact storage, push notifications, new diagnostic
rules, a natural-date picker, new action-card lifecycle mutations, customer
contact data, POS/platform integration, or a new parallel Home/navigation model.
