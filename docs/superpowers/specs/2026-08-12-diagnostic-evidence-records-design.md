# Diagnostic Evidence Records Design

## Goal

Make each actionable deterministic diagnosis independently auditable. A stored
diagnostic record freezes the confirmed-fact snapshot, comparison periods,
rule version, confidence, and metric evidence used to produce the conclusion.
Action cards created from the diagnosis reference that record.

The feature remains an independent architecture. It does not use POS, ERP,
membership, delivery, platform, or vendor integrations. It does not store raw
report files, object keys, source locators, model prompts, or generated model
content in diagnostic evidence.

## Scope

The first release supports the existing `revenue_decline` deterministic rule
only. It records one current-period revenue value, one prior-period revenue
value, their percent change, the two fact-version IDs, and the stable rule
version `revenue_decline_v1`.

No record is created when data readiness prevents a diagnosis or when the rule
does not find an actionable revenue decline. Existing manual action-card
creation remains possible without a diagnostic record; it must not invent a
record or evidence.

## Data Model

Add immutable, store-scoped tables:

| Table | Key fields | Purpose |
| --- | --- | --- |
| `diagnostic_runs` | `id`, enterprise/store IDs, kind, current/prior periods, `rule_version`, confidence, `snapshot_key`, timestamps | Auditable conclusion header |
| `diagnostic_evidence` | `id`, `diagnostic_run_id`, metric key, current/prior values, change percent, current/prior fact-version IDs | Auditable numeric basis |

`snapshot_key` is a SHA-256 hash of the canonical diagnostic payload: enterprise
and store IDs, kind, periods, rule version, confidence, metric key, values, and
source fact-version IDs. A unique constraint on the enterprise/store scope and
`snapshot_key` makes repeated read requests idempotent. New confirmed facts,
different periods, or a new rule version produce a distinct record.

Add nullable `diagnostic_run_id` to `action_cards`. It has a composite scoped
foreign key to the diagnostic record and is written only by the existing
"create from deterministic diagnosis" flow. Manual action cards retain `NULL`.

## Service and API Flow

1. The deterministic diagnostic calculation continues to read confirmed facts
   only and performs no model call.
2. If it returns `revenue_decline`, the service persists or reuses the matching
   diagnostic record and evidence in one database transaction.
3. The deterministic endpoint returns the existing public fields plus
   `diagnosticRunId`, `ruleVersion`, and a numeric evidence list. Its evidence
   does not contain source batch IDs, candidate IDs, object keys, or files.
4. Creating an action card from that endpoint gets the persisted diagnostic run
   and passes its ID into action-card creation. A stale or missing record is an
   internal consistency failure, never silently replaced with unlinked data.
5. Reading an action card returns nullable `diagnosticRunId`; reading a stored
   diagnostic run is store-scoped and public-field-only.

The design intentionally does not persist a no-diagnosis result. A new import
may make a previously unavailable or non-actionable period actionable, and
absence remains a fresh read-time determination.

## Android Display

The Operations screen renders a concise evidence section beneath a deterministic
diagnosis: rule version, current and prior revenue values, and percentage change.
It does not display raw source identifiers. Action cards with a non-null
`diagnosticRunId` show that they originated from recorded evidence; manual cards
show no fabricated provenance.

## Error Handling

The diagnostic read and persistence operation is atomic. A database failure does
not return a diagnosis without its required record. Database duplicate-key races
reload the scoped record by snapshot key. Scoped lookup failures, foreign-key
violations, and unexpected persistence failures use existing neutral API error
handling; clients receive no raw exception text.

## Testing

Add API tests for:

- run/evidence persistence from confirmed facts and exact public output;
- same-snapshot idempotency and changed-fact/rule-version new snapshots;
- no record for missing data or no diagnosis;
- enterprise/store isolation and action-card composite reference;
- create-from-diagnostic linkage and manual-card null linkage;
- endpoint privacy shape excluding raw import/object identifiers.

Add Android repository/ViewModel tests for the extended public DTO mapping and
the evidence rendering state. Complete the API suite and typecheck, Android
Debug unit tests, Debug APK, Release APK, migration verification, and
`git diff --check` before delivery.
