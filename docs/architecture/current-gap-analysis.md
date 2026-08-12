# Current Architecture Gap Analysis

Date: 2026-08-12

This document compares the current independent implementation with the product
framework in `餐饮门店AI运营助手-完整产品与技术框架(3).md`. The project remains
an independent architecture. It does not depend on a restaurant POS, membership
system, platform account, or vendor-specific integration.

## What Is Implemented

The current branch provides a reliable import and local-workspace foundation:

- Android workspace with persisted navigation, task, import, diagnosis, and
  video-factory demo state. In debug builds, the operations surface reads the
  independent API's readiness, deterministic diagnosis, action-card, and
  published metric-catalog contracts.
- CSV/XLSX/manual import through a trusted store context.
- Candidate parsing, uncertainty marking, per-candidate editing, and explicit
  confirmation before fact versions are created.
- Original-file storage in MinIO with tenant/store-scoped object keys and 90-day
  expiry metadata.
- PostgreSQL import batches, candidates, facts, checksums, and file metadata.
- Durable reconciliation for uncertain object/database outcomes, guarded batch
  verification, bounded guard retention, and maintenance status reporting.
- Locked cleanup, reconciliation, and status CLIs with maintenance-only Compose
  services.
- Versioned metric catalogs with immutable published definitions, fact-version
  binding, a read-only store catalog endpoint, and a provider-operated JSON
  publish CLI.
- Data-readiness calculation, a deterministic revenue-decline diagnostic with
  persisted evidence, action-card lifecycle, and verification summaries.
- API/Android tests, Compose validation, CI workflow, and health checks.

This is the framework's data-entry and reliability substrate, not yet the full
AI operations product.

## Framework Differences

### Covered or partially covered

| Framework area | Current state | Difference |
| --- | --- | --- |
| Import batches and traceability | Covered for manual/file imports | No external source-system adapters or mapping-version registry yet |
| Data quality and confirmation | Covered for parser confidence, unresolved candidates, catalog validation, and readiness | Custom header-to-metric mapping and source-report mapping versions are not implemented |
| Metric semantics | Covered by a versioned published catalog and provider publish CLI | No authenticated web console; adding a metric does not automatically alter an existing diagnostic rule |
| Android operating workspace | Debug builds consume trusted API readiness, diagnosis, catalog, action, and verification data | Release/local-demo remains deliberately unavailable; there is no account sign-in or remote workspace provisioning |
| Video workflow | Six-stage local demo covered | No real project, asset, render, publish, or performance entities |
| Single-store P0 isolation | Covered by trusted context and composite tenant/store keys | Authentication and account/entitlement service are not implemented |
| Maintenance operations | Covered | Operational jobs are not yet connected to business outcome metrics |

### Not implemented yet

1. **Identity and service-operator access boundary**
   - Account identity, authenticated tenant/store claims, and entitlement
     checks that replace the current trusted development context.
   - A separately authorized service-operator surface for metric catalog,
     mapping, rule, and support administration. The existing catalog CLI is an
     intentional interim operator interface, not a public HTTP administration
     endpoint.

2. **Metric mapping and broader normalized snapshots**
   - Mapping versions and source report types for custom headers and future
     independent source adapters.
   - Normalized snapshots for channel funnel, dishes, packages, members,
     reviews, and content performance. POS, membership, and platform
     integrations remain explicitly out of this independent P0 scope.

3. **Diagnostic expansion**
   - Additional deterministic rules, hypotheses, report versions, and
     cross-period coverage beyond the implemented revenue-decline rule.
   - Explicit rule-to-catalog compatibility so a newly published definition is
     usable only after an appropriate rule is deliberately added.

4. **Owner question interface**
   - Evidence-bound question classification and structured answers.
   - Explicit insufficient-data responses and action creation from a question.

5. **Content and inspiration domain**
   - Inspiration pool, scoring, deduplication, cooling period, compliance
     records, content projects, publication records, and performance links.
   - Real template-based rendering and publish-result capture.

6. **Private-domain and platform operations**
   - Audience segments, contact plans, coupon/use outcomes, platform funnel
     adapters, and review aggregation.

7. **Operations web console**
   - Authenticated mapping, rule, template, compliance, customer-support, and
     multi-store administration. It must use the same versioned catalog
     lifecycle as the provider CLI.

## Recommended Next Sequence

The next implementation unit should be an **identity and service-operator
access boundary**, before a web administration console, model integration, or
real video rendering:

1. Define account, tenant, store, actor, and service-operator roles without
   weakening the existing composite tenant/store isolation.
2. Replace trusted HTTP context with validated claims at the API boundary while
   keeping maintenance CLIs as separately configured operator processes.
3. Define the operator authorization policy for catalog publication and future
   mapping/rule changes before registering any operator HTTP route.
4. Add an authenticated provider web console only after these boundaries are
   tested; it should call the existing catalog lifecycle rather than mutate
   published definitions directly.
5. Expand metric mapping and diagnostic rules after their authoring surface has
   an auditable identity and version history.

This sequence preserves the framework's most important guarantee: the AI may
explain and draft language, but it cannot invent business facts or skip data
readiness checks.

## Explicitly Deferred

The following remain outside the current independent P0 implementation:

- POS, membership, platform, or vendor-specific synchronization.
- Automatic scraping or unauthorized platform content retrieval.
- Employee roles, multi-store collaboration, and complex permissions.
- Full AI-generated video, digital humans, professional timeline editing, and
  automatic publishing to external platforms.
- Food-safety, tax, legal, employment, or other regulated conclusions.
