# Versioned Metric Catalog Design

## Goal

Replace scattered metric semantics with a versioned catalog that service
operators can extend safely. A published definition fixes the meaning of newly
confirmed facts, while historical facts remain interpretable under the catalog
version that was active when they were confirmed.

## Scope

The first increment provides catalog persistence, draft editing through an
internal API surface, publication validation, a current published catalog
reader, and fact-version binding. It migrates the seven existing importer
metrics into immutable catalog version `v1`.

It does not provide a service-operator web console, POS/ERP/member/delivery
integration, automatic metric mapping, model-generated rules, or a mechanism
for an arbitrary new metric to join an existing diagnostic automatically.

## Catalog Model

`metric_catalog_versions` has an opaque ID, monotonic version number, state
(`draft`, `published`, `retired`), timestamps, and publication timestamp. At
most one row may be `published`. A published or retired row is immutable.

`metric_definitions` belongs to exactly one catalog version and contains:

- stable `metric_key`, display name, and optional business-format scope;
- value kind: `amount`, `count`, or `ratio`;
- storage unit: `cents`, `count`, or `basis_points`;
- `allow_negative` and `require_positive` value-domain flags;
- `usable_for_readiness`, `usable_for_diagnostic`, and
  `usable_for_verification` flags;
- `enabled` flag and timestamps.

`metric_key` is unique within one catalog version. Value kind and storage unit
must agree: `amount/cents`, `count/count`, `ratio/basis_points`. A definition
with `require_positive` must not allow negative values. A definition disabled
for import can remain historically visible and may be retained for read-only
interpretation.

## Published v1

The migration seeds and publishes catalog `v1` with these existing metrics:

| Key | Kind / unit | Positive | Readiness | Diagnostic | Verification |
| --- | --- | --- | --- | --- | --- |
| `revenue` | amount / cents | no | yes | yes | yes |
| `orders` | count / count | yes | yes | no | yes |
| `average_spend` | amount / cents | yes | yes | no | no |
| `package_sales` | amount / cents | yes | no | no | no |
| `package_redemptions` | count / count | no | no | no | no |
| `refunds` | amount / cents | no | no | no | no |
| `promotion_spend` | amount / cents | no | no | no | no |

`revenue`, `refunds`, and `promotion_spend` are allowed to be zero or positive
but not negative. The other amount and count metrics follow their existing
confirmation boundaries. The table documents current behavior rather than
broadening it.

## Service Operator Lifecycle

An operator creates the next draft version from the published version, then may
add definitions, disable definitions, or change a definition only in that
draft. Publishing validates all constraints, requires all current core metrics
(`revenue`, `orders`, `average_spend`) to remain enabled and readiness-usable,
then atomically retires the previous published version and publishes the draft.

No API permits updates or deletes to published/retired definitions. Changing a
published metric's display name, unit, domain flags, or eligibility requires a
new draft and publication. A future web console uses these same APIs; it does
not gain a bypass.

## Fact and Import Rules

`fact_versions` gains non-null `metric_catalog_version_id` pointing to the
catalog version used at confirmation. Confirmation resolves the single current
published catalog inside the existing transaction, validates each selected
candidate against its enabled definition, and writes that catalog ID alongside
the new fact version. The fact values remain append-only and need no duplicate
catalog column because their parent version identifies the semantics.

Manual candidate creation remains structurally permissive so users can import
unknown headers as unresolved candidates. A candidate can become a confirmed
fact only when the published catalog contains an enabled matching definition
and its unit/value domain conforms. File parser recognition stays restricted to
the existing v1 aliases in this increment; custom metric header mapping is a
later operator feature.

## Public Read APIs

Add a trusted service-operator API for draft creation, draft-definition upsert,
and publication. It is not registered under the local store routes and must be
injected explicitly by a future authenticated operator application.

Add `GET /v1/stores/:storeId/metric-catalog` to the trusted store API. It
returns the current published catalog's version number and only enabled public
definitions: key, display name, value kind, storage unit, and eligibility
flags. It returns no operator, draft, retired-version, internal ID, fact,
candidate, batch, file, or object data.

## Diagnostic and Verification Boundaries

Existing revenue-decline and action verification logic continue to use their
currently named core metrics. Their current rules are unchanged. Catalog flags
provide the authoritative eligibility information for later generic readiness,
diagnostic, and verification engines, but no custom definition becomes part of
a current rule merely by being marked eligible.

## Android Boundary

The Android import editor continues its current v1 unit behavior in this
increment. It gains a read-only catalog DTO and repository method so a future
editor can display catalog-backed labels and units, but it must not fetch or
store draft definitions and must not manufacture a custom metric input flow.
The API is unavailable in release/local-demo configurations exactly like other
operations data.

## Testing

Backend tests cover v1 seed/public uniqueness, draft-only mutation, validation
of kind/unit/domain constraints, publish/retire atomicity, core-metric guard,
confirmation binding and rejection of disabled/unknown/unit-invalid metrics,
and store API privacy shape. Android tests cover public catalog DTO mapping,
the trusted endpoint path, and unavailable-repository behavior. Full API and
Android verification remains required.
