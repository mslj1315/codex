# Current Architecture Gap Analysis

Date: 2026-08-12

This document compares the current independent implementation with the product
framework in `餐饮门店AI运营助手-完整产品与技术框架(3).md`. The project remains
an independent architecture. It does not depend on a restaurant POS, membership
system, platform account, or vendor-specific integration.

## What Is Implemented

The current branch provides a reliable import and local-workspace foundation:

- Android local workspace with persisted navigation, task, import, diagnosis,
  and video-factory demo state.
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
- API/Android tests, Compose validation, CI workflow, and health checks.

This is the framework's data-entry and reliability substrate, not yet the full
AI operations product.

## Framework Differences

### Covered or partially covered

| Framework area | Current state | Difference |
| --- | --- | --- |
| Import batches and traceability | Covered for manual/file imports | No external source-system adapters or mapping-version registry yet |
| Data quality and confirmation | Covered for parser confidence and unresolved candidates | No cross-period readiness score or metric-definition service |
| Android operating workspace | Local demo covered | Uses deterministic local content; no server-backed diagnosis/action data |
| Video workflow | Six-stage local demo covered | No real project, asset, render, publish, or performance entities |
| Single-store P0 isolation | Covered by trusted context and composite tenant/store keys | Authentication and account/entitlement service are not implemented |
| Maintenance operations | Covered | Operational jobs are not yet connected to business outcome metrics |

### Not implemented yet

1. **Unified metric foundation**
   - `metric_definition`, `metric_mapping`, mapping versions, and source report
     types.
   - Normalized snapshots for revenue, orders, average spend, channel funnel,
     dishes, packages, members, reviews, and content performance.

2. **Diagnostic and action domain**
   - `diagnostic_run`, evidence, confidence, hypotheses, and report versions.
   - `action_card`, execution state, verification window, evidence, and review
     outcome.
   - A deterministic rule/statistics layer before any model-generated language.

3. **Owner question interface**
   - Evidence-bound question classification and structured answers.
   - Explicit insufficient-data responses and action creation from a question.

4. **Content and inspiration domain**
   - Inspiration pool, scoring, deduplication, cooling period, compliance
     records, content projects, publication records, and performance links.
   - Real template-based rendering and publish-result capture.

5. **Private-domain and platform operations**
   - Audience segments, contact plans, coupon/use outcomes, platform funnel
     adapters, and review aggregation.

6. **Operations web console**
   - Mapping, rule, template, compliance, customer-support, and multi-store
     administration.

## Recommended Next Sequence

The next implementation unit should be the **metric foundation and diagnostic
readiness contract**, before model integration or real video rendering:

1. Define a small versioned metric catalog for the metrics already emitted by
   the importer: revenue, orders, average spend, package sales, redemptions, and
   refunds.
2. Add a read-only readiness calculation that reports available periods,
   missing required metrics, confidence, and comparison eligibility.
3. Add diagnostic evidence records and a deterministic first diagnostic rule
   using confirmed facts only.
4. Expose a structured diagnostic endpoint and render its evidence/action state
   in Android.
5. Add action-card persistence and verification only after the diagnostic
   contract is stable.

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

