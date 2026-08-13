# Restaurant Video Content Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first restaurant video-content planning loop from store profile and operating goals through AI-assisted topic/copy/shot-list generation, customer-side review, single-task Douyin feedback import, outcome analysis, and one-variable experiment suggestions.

**Architecture:** Extend the existing TypeScript Fastify API and provider-console frontend with separate customer-content, operator-template/rule, and platform-training boundaries. Android consumes the same API contracts for profile and content planning, while model providers are hidden behind an injectable server-side adapter. Reuse the existing bounded CSV/XLSX import and confirmation primitives for single-task Douyin reports; do not add media upload, rendering, or platform publishing in this plan.

**Tech Stack:** TypeScript, Fastify, PostgreSQL migrations, Vitest, React/TypeScript provider console, Kotlin/Jetpack Compose, Retrofit/OkHttp, DeepSeek and Qwen HTTP adapters behind a common interface.

---

## Scope And File Map

API modules:

- `services/api/src/content-planning/`: store profile, operating stages, content tasks, topics, copies, shot lists, review records, experiments, and visibility services.
- `services/api/src/model-providers/`: provider interface, DeepSeek adapter, Qwen adapter, structured response validation, retry policy, and usage records.
- `services/api/src/operator-content/`: published template and review-rule management with editor/reviewer role checks.
- `services/api/src/douyin-feedback/`: single-task report mapping, metric normalization, period snapshots, baselines, and analysis.
- `services/api/migrations/013_content_planning.sql` through later numbered migrations as needed; every migration remains append-only and versioned.

Console modules:

- `apps/provider-console/src/content-planning/`: customer task creation, topic selection, copy selection/editing, review state, shot-list confirmation, and outcome view.
- `apps/provider-console/src/operator-content/`: template/rule editor and publish/review screens.

Android modules:

- `apps/android/app/src/main/java/com/restaurantops/content/`: profile, operating stage, content task, topic/copy/shot-list models, Retrofit repository, ViewModels, and Compose screens.

Tests must remain adjacent to the existing API, console, and Android test conventions. Existing aggregate feedback, Android auth, and import contracts must remain unchanged.

### Task 1: Persist Store Profile And Operating Stages

**Files:**
- Create: `services/api/migrations/013_content_planning_profile.sql`
- Create: `services/api/src/content-planning/profile-repository.ts`
- Create: `services/api/test/content-planning-profile.test.ts`
- Modify: `services/api/src/server.ts`, auth route registration, Android profile models/repository/screens

- [ ] **Step 1: Write failing database and API tests**

Cover required first-visit fields, category code plus custom name, address hierarchy, district type plus note, operating mode, one primary plus optional secondary goal, effective-dated stages, same-day uniqueness, and historical snapshot immutability.

- [ ] **Step 2: Run focused tests and confirm missing migration/repository failures**

Run `npm test -- --run test/content-planning-profile.test.ts` from `services/api`; expect failures because the new migration and repository do not exist.

- [ ] **Step 3: Add the migration and repository**

Use normalized codes for industry/category/district/mode/goal values, keep detailed address as store data, enforce required fields and stage effective-date uniqueness, and expose transaction-safe create/update/read methods with a profile completeness summary.

- [ ] **Step 4: Add customer-facing API and Android state**

Expose authenticated `GET/POST/PUT /v1/stores/:storeId/content-profile` and `/operating-stages`; Android must submit the minimal required profile before content generation, while optional fields remain skippable and show completeness.

- [ ] **Step 5: Verify and commit**

Run focused API tests, API typecheck, Android unit tests for required/optional fields, and `git diff --check`; commit `feat: add content planning store profile`.

### Task 2: Add Published Template And Review-Rule Management

**Files:**
- Create: `services/api/migrations/014_content_templates_rules.sql`
- Create: `services/api/src/operator-content/template-repository.ts`
- Create: `services/api/src/operator-content/rule-repository.ts`
- Create: `services/api/src/operator-content/routes.ts`
- Create: `services/api/test/operator-content-routes.test.ts`
- Create/modify: `apps/provider-console/src/operator-content/*`, route registration and navigation

- [ ] **Step 1: Write failing role and lifecycle tests**

Test editor can create/edit/submit drafts, reviewer can publish/return/disable, published versions are immutable, provider roles receive neutral 403, and only published templates/rules participate in matching.

- [ ] **Step 2: Implement versioned structured templates**

Persist hook, story, value, product appearance, CTA, shot rhythm, caption/voice requirements, industry/category/persona/content type/commercial level/style constraints, fallback scope, price/discount/effect restrictions, and immutable version records.

- [ ] **Step 3: Implement versioned rule lifecycle**

Persist absolute-word patterns, semantic categories, severity, platform/scope, guidance, status, editor/reviewer audit fields, and test-preview endpoint. Published rules must be selected by version, never mutated in place.

- [ ] **Step 4: Build operator-console screens**

Add draft/list/detail/test/publish/return/disable flows using existing session and layout components, with separate role-gated routes from provider feedback/customer metadata.

- [ ] **Step 5: Verify and commit**

Run focused API/console tests, typechecks, and build; commit `feat: add operator content templates and rules`.

### Task 3: Add Model Provider Abstraction And Structured Generation

**Files:**
- Create: `services/api/src/model-providers/provider.ts`
- Create: `services/api/src/model-providers/deepseek.ts`
- Create: `services/api/src/model-providers/qwen.ts`
- Create: `services/api/src/model-providers/generation.ts`
- Create: `services/api/test/model-providers.test.ts`
- Modify: `.env.example`, package dependencies, server wiring

- [ ] **Step 1: Write failing adapter contract tests**

Use injected HTTP clients to assert normalized requests/responses, structured schema failures, timeouts, bounded same-provider retries, provider/model usage, and no key/input logging.

- [ ] **Step 2: Define the common interface**

Implement `generateStructured({requestId, provider, model, promptVersion, input, schema}) -> {provider, model, output, usage, latencyMs}`; provider selection comes only from server configuration and defaults to one configured provider.

- [ ] **Step 3: Implement DeepSeek and Qwen adapters**

Map each vendor’s authentication/request/response format to the common interface. Do not expose adapters or credentials to Android. Do not silently fall back between providers.

- [ ] **Step 4: Add generation output validation**

Validate topic arrays, three materially distinct copy drafts, shot-list structure, commercial-level limits, required product/goal references, and safe integer/count bounds before persistence.

- [ ] **Step 5: Verify and commit**

Run adapter tests, API typecheck, dependency audit at high severity, and `git diff --check`; commit `feat: add pluggable content model providers`.

### Task 4: Implement Content Task, Topic, Copy, Review, And Shot-List Workflow

**Files:**
- Create: `services/api/migrations/015_content_tasks.sql`
- Create: `services/api/src/content-planning/task-repository.ts`
- Create: `services/api/src/content-planning/generation-service.ts`
- Create: `services/api/src/content-planning/review-service.ts`
- Create: `services/api/src/content-planning/routes.ts`
- Create: `services/api/test/content-planning-routes.test.ts`
- Create/modify: Android content models/repository/ViewModel/screens and console customer-planning screens

- [ ] **Step 1: Write failing workflow tests**

Cover dynamic three-angle topics, topic selection, three copy drafts with distinct strategies, customer draft editing, rule+AI blocking, confirmation lock, shot-list generation only from confirmed copy, and immutable version history.

- [ ] **Step 2: Implement task/version schema and repository**

Store input snapshots, profile/stage snapshots, template match/fallback metadata, provider/model/prompt/template/rule versions, topic/copy/shot-list versions, and customer confirmation timestamps without exposing raw unconfirmed content to providers.

- [ ] **Step 3: Implement template matching**

Match exact constraints first, then category/industry/general fallbacks; never relax platform, commercial-level, or safety constraints; record match level and fallback path.

- [ ] **Step 4: Implement generation workflow**

Generate topics, then copies, then shot list in separate authenticated commands. Enforce customer confirmation gates and one-variable experiment constraints where present.

- [ ] **Step 5: Implement review workflow**

Run deterministic rules first and AI semantic review second. Save drafts on risk, return actionable customer-only findings, and allow confirmation only with no blocking findings and successful review service.

- [ ] **Step 6: Implement Android and console UX**

Add fixed preset selectors, optional inspiration/reference fields, three topic cards, three copy drafts, editor with draft-save/risk state, confirmation actions, and shot-list review. Do not add media upload or publishing controls.

- [ ] **Step 7: Verify and commit**

Run API, console, and Android focused suites plus typechecks/builds; commit `feat: add content planning generation workflow`.

### Task 5: Add Single-Task Douyin Feedback Import And Period Snapshots

**Files:**
- Create: `services/api/migrations/016_douyin_feedback.sql`
- Create: `services/api/src/douyin-feedback/mapping-repository.ts`
- Create: `services/api/src/douyin-feedback/import-service.ts`
- Create: `services/api/test/douyin-feedback.test.ts`
- Modify: existing bounded import composition and Android/console import screens

- [ ] **Step 1: Write failing mapping/import tests**

Cover one content task per upload, 3/7/14-day allowed periods, duplicate task-period-hash rejection, publishedAt versus metric range, recognized/missing/unrecognized fields, and no missing-as-zero behavior.

- [ ] **Step 2: Implement versioned mapping templates**

Operator-published mappings normalize raw column names, units, metric groups, required/core flags, and report type. Preserve raw column, normalized value, mapping version, range, and source metadata.

- [ ] **Step 3: Implement single-task import**

Require task selection and published video link context, reject multi-video reports in this phase, reuse bounded CSV/XLSX parsing/storage, and append immutable period snapshots.

- [ ] **Step 4: Add client flows**

Allow a customer to select one published task, provide/edit video URL and publish time, upload one report, inspect recognized/missing/unrecognized fields, and confirm without exposing raw report data to providers.

- [ ] **Step 5: Verify and commit**

Run focused API/Android/console tests, typechecks, and build; commit `feat: import single-task Douyin feedback`.

### Task 6: Add Goal-Aware Effect Review, Baselines, And Experiments

**Files:**
- Create: `services/api/migrations/017_content_effects.sql`
- Create: `services/api/src/douyin-feedback/baseline-service.ts`
- Create: `services/api/src/douyin-feedback/effect-service.ts`
- Create: `services/api/src/content-planning/experiment-service.ts`
- Create: `services/api/test/content-effects.test.ts`
- Modify: console outcome/review screens and Android read-only review models

- [ ] **Step 1: Write failing analysis tests**

Cover target-specific completeness, 90-day same-store same-type baseline priority, fallback baseline levels, sample thresholds, exclusion flags, 3/7/14-day state, fact/possible-cause/next-step separation, and one-variable experiment suggestions.

- [ ] **Step 2: Implement baseline calculation**

Use same-store same-type median/range first, then store industry/category aggregate; exclude incomplete, interrupted, paid, holiday, closure, and anomalous rows by default. Persist baseline version, scope, sample count, and calculation time.

- [ ] **Step 3: Implement effect conclusions**

Render content performance, product conversion, and operating-goal sections separately. If core goal metrics are missing, report partial analysis rather than “sales failed.”

- [ ] **Step 4: Implement experiment suggestion/confirmation**

Generate one low-complexity suggestion, require customer confirmation before creating an experiment, allow only one active experiment per store, and persist hypothesis/unchanged/changed/observed fields and final outcome.

- [ ] **Step 5: Verify and commit**

Run focused tests and UI checks; commit `feat: add content effect review and experiments`.

### Task 7: Enforce Visibility, Training Candidates, And Audit

**Files:**
- Create: `services/api/migrations/018_content_visibility_training.sql`
- Create: `services/api/src/content-planning/training-service.ts`
- Create: `services/api/test/content-visibility-training.test.ts`
- Modify: provider-console accessors, platform operator routes, audit allowlists, and docs

- [ ] **Step 1: Write failing visibility tests**

Prove customers see own drafts, providers see only assigned-store confirmed final copy and aggregates, providers cannot see raw reports/risk drafts, and authorized training reviewers can view confirmed originals but cannot export.

- [ ] **Step 2: Implement training candidate lifecycle**

After a complete period (default 7 days, with allowed 3/14 exceptions), generate candidates only after automatic quality checks. Require internal review before immutable training-set inclusion; support return/exclude/withdraw with reasons and versions.

- [ ] **Step 3: Add platform-internal audit and export denial**

Record viewer, role, enterprise/store scope, task ID, time, purpose, and training batch/version. Do not add download/export endpoints for original customer copy.

- [ ] **Step 4: Verify and commit**

Run privacy, authorization, audit, console, and API tests; commit `feat: protect content visibility and training samples`.

### Task 8: Full Verification And Documentation

**Files:**
- Modify: `docs/architecture/current-gap-analysis.md`, relevant operations docs, `.env.example`, Compose maintenance profile, CI workflow if needed
- Test: API full suite, console full suite, Android unit/build suite, Compose configuration

- [ ] **Step 1: Run API full verification**

From `services/api`, run `npm test`, `npm run typecheck`, and `npm audit --audit-level=high`; record any pre-existing moderate advisories without unrelated dependency upgrades.

- [ ] **Step 2: Run console full verification**

From `apps/provider-console`, run full tests, `npm run typecheck`, and `npm run build`.

- [ ] **Step 3: Run Android verification**

Run `gradlew testDebugUnitTest`, `assembleDebug`, and `assembleRelease` with Release checks proving no local API URL, provider credentials, or model keys.

- [ ] **Step 4: Run privacy and boundary searches**

Search runtime code for raw-report exposure, local/session storage, unsafe HTML, provider cross-scope routes, model-key logging, and third-party platform synchronization. Verify existing Android auth and aggregate provider-feedback responses are unchanged.

- [ ] **Step 5: Update docs and complete review**

Document role provisioning, template/rule publishing, model-provider environment configuration, report mapping maintenance, baseline policy, training review policy, and explicit non-scope of media editing/publishing. Run `git diff --check`, review the complete branch, then stop before push/deploy until explicitly authorized.

