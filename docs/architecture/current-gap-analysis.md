# Current Architecture Gap Analysis

Date: 2026-08-13

This document compares the current independent implementation with the product
framework in `餐饮门店AI运营助手-完整产品与技术框架(3).md`. The project remains
an independent architecture. It does not depend on a restaurant POS, membership
system, platform account, or vendor-specific integration.

## What Is Implemented

The current branch provides a reliable import and local-workspace foundation:

- Android workspace with persisted navigation, task, import, diagnosis, and
  video-factory demo state. Authenticated Home reads only the latest confirmed
  server period, then presents matching readiness, deterministic diagnosis, and
  actionable cards. Missing or stale data is explicitly guided to import; no
  remote Home path renders fixed demo operational values.
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
- Self-hosted API account authentication with scrypt password hashing,
  revocable/rotatable sessions, server-derived store memberships, and controlled
  account provisioning. Service-provider roles are independent of store access.
- An authenticated provider-feedback projection for `provider_feedback_viewer`.
  It returns only bounded, audited aggregates for `enterpriseId`/`storeId`
  support follow-up: activity, readiness summary, diagnostic availability, and
  action/verification counts. It does not expose imports, facts, files,
  evidence, or action content.
- An authenticated provider web console for the bounded feedback projection.
  It can display an independent customer alias and internal provider note only
  to feedback viewers; editing requires both `provider_feedback_viewer` and
  `provider_customer_metadata_editor`. Metadata does not create scope
  visibility, and the console/API do not expose raw customer data, imports,
  facts, files, evidence, account attribution, or action content.
- API/Android tests, Compose validation, CI workflow, and health checks.

This is the framework's data-entry and reliability substrate, not yet the full
AI operations product.

## Framework Differences

### Covered or partially covered

| Framework area | Current state | Difference |
| --- | --- | --- |
| Import batches and traceability | Covered for manual/file imports | No external source-system adapters or mapping-version registry yet |
| Data quality and confirmation | Covered for parser confidence, unresolved candidates, catalog validation, and readiness | Custom header-to-metric mapping and source-report mapping versions are not implemented |
| Metric semantics | Covered by a versioned published catalog and provider publish CLI | Catalog Web editing is not implemented; adding a metric does not automatically alter an existing diagnostic rule |
| Android operating workspace | Authenticated sessions, encrypted refresh-token storage, store selection, trusted API calls, and latest-confirmed Home data are covered | Real-device/provider instrumentation and broader daily-operation workflows remain to be expanded |
| Video workflow | Six-stage local demo covered | No real project, asset, render, publish, or performance entities |
| Single-store P0 isolation | Covered by trusted context and composite tenant/store keys | Authentication and account/entitlement service are not implemented |
| Maintenance operations | Covered | Operational jobs are not yet connected to business outcome metrics |

### Not implemented yet

1. **Service-provider administration**
   - The authenticated provider web console covers bounded feedback reading and
     independent alias/internal-note metadata. Catalog lifecycle Web controls
     after verifying `metric_catalog_operator` are still not implemented.

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
     lifecycle as the provider CLI. Contacts and follow-up workflow are not
     implemented.

## Recommended Next Sequence

The next implementation unit should be **catalog lifecycle Web controls**, after
the Android reliable-data states and implemented provider feedback console,
before model integration or real video rendering:

1. Retain the authenticated provider-only shell, which derives authorization
   from server-issued roles and does not infer tenant scope in the browser.
2. Retain the bounded feedback and independent alias/internal-note view; keep
   the server's prohibition on raw imports, facts, files, evidence, action
   content, contacts, and follow-up data.
3. Add catalog lifecycle controls only for `metric_catalog_operator`, reusing
   the existing versioned publish contract.
4. Keep the explicit Android local-demo path separate and ensure remote Home
   continues to show only latest-confirmed server data.

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
