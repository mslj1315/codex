# 餐饮企业运营 AI 平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Android 优先的企业餐饮运营 AI 平台基础，并交付企业授权、首次建档、数据确认、周诊断与任务闭环。

**Architecture:** 使用 monorepo 管理原生 Android App、TypeScript 后端、媒体工作服务和运营后台。Android 只负责登录、表单、查看和受控上传；后端负责企业隔离、业务事实、AI 编排、成本账本和授权；第二阶段 iOS 客户端复用 API 合约与数据模型；视频渲染与 AI 视频工厂在后续独立计划中接入同一数据模型。

**Tech Stack:** Kotlin、Jetpack Compose、Coroutines、Retrofit、TypeScript、Fastify、PostgreSQL、Drizzle ORM、Redis、BullMQ、S3-compatible object storage、OpenAPI、Vitest、Playwright、JUnit。

---

## Delivery sequence

本计划只实现能独立验收的“基础与经营顾问”切片。其余系统在本计划稳定后进入独立计划，避免视频处理或运营后台阻塞核心经营闭环。

1. `restaurant-video-factory.md`：选题、文字合规、分镜、素材技术质检、模板化剪辑、渲染队列和视频库。
2. `restaurant-operations-console.md`：业态题库、热点池、规则、模板、投诉、额度和成本监控。
3. `restaurant-ios-release.md`：IAP 兜底路径、企业审核演示、隐私、TestFlight、App Store 提审与生产运维。

## Target repository layout

```text
apps/
  android/
  api/
  admin/
packages/
  domain/
  api-contract/
  config/
infra/
  docker-compose.yml
  migrations/
docs/
  architecture/
  superpowers/
```

`packages/domain` 只定义跨端业务类型和纯计算；`apps/api` 持有数据库、鉴权和 AI 调用；`apps/android` 不保存模型 API 密钥；第二阶段新增 `apps/ios` 并只复用 API 合约；`apps/admin` 不直接读生产数据库，只通过受权限控制的管理 API 访问。

### Task 1: Initialize the monorepo and local runtime

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `infra/docker-compose.yml`
- Create: `packages/config/tsconfig.base.json`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Write the workspace configuration and local service contract**

```json
{
  "name": "restaurant-ops",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "dev": "turbo dev",
    "test": "turbo test",
    "lint": "turbo lint",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": { "turbo": "^2.3.0", "typescript": "^5.7.0" }
}
```

```yaml
packages:
  - apps/*
  - packages/*
```

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: restaurant_ops
      POSTGRES_USER: restaurant_ops
      POSTGRES_PASSWORD: restaurant_ops
    ports: ["5432:5432"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

- [ ] **Step 2: Start the local dependencies and verify health**

Run: `docker compose -f infra/docker-compose.yml up -d`

Expected: PostgreSQL accepts connections on `5432`; Redis accepts ping on `6379`.

- [ ] **Step 3: Add a CI baseline**

Create `.github/workflows/ci.yml` that runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, and `pnpm test` on pull requests and `main` pushes.

- [ ] **Step 4: Commit the bootstrap**

```bash
git add package.json pnpm-workspace.yaml turbo.json infra packages/config .env.example README.md .github
git commit -m "chore: bootstrap restaurant ops monorepo"
```

### Task 2: Define the enterprise, store, entitlement, and fact domain

**Files:**
- Create: `packages/domain/src/entities.ts`
- Create: `packages/domain/src/metrics.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/domain/test/metrics.test.ts`
- Create: `packages/api-contract/src/enterprise.ts`
- Create: `packages/api-contract/src/index.ts`

- [ ] **Step 1: Write failing tests for financial and funnel calculations**

```ts
import { calculateRoi, calculateGrossMargin } from "../src/metrics";

it("calculates gross margin from confirmed revenue and cost", () => {
  expect(calculateGrossMargin({ revenue: 1_000, cost: 620 })).toBe(0.38);
});

it("returns null when ROI denominator is zero", () => {
  expect(calculateRoi({ grossProfit: 300, promotionSpend: 0 })).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @restaurant-ops/domain test`

Expected: FAIL because `metrics.ts` has not yet been created.

- [ ] **Step 3: Implement stable domain types and calculations**

```ts
export type EnterpriseId = string & { readonly __brand: "EnterpriseId" };
export type StoreId = string & { readonly __brand: "StoreId" };
export type BusinessType =
  | "chinese_dining"
  | "quick_service"
  | "hotpot_bbq"
  | "tea_coffee"
  | "bakery_dessert";

export interface Entitlement {
  enterpriseId: EnterpriseId;
  status: "active" | "expired" | "suspended";
  expiresAt: string;
  storeLimit: number;
  aiMode: "managed_credits" | "bring_your_own_key";
}

export interface StoreFactVersion {
  storeId: StoreId;
  version: number;
  confirmedByUserId: string;
  effectiveAt: string;
  businessType: BusinessType;
  averageSpendCents: number;
}

export interface StoreTag {
  storeId: StoreId;
  name: string;
  evidence: string[];
  confidence: "low" | "medium" | "high";
  expiresAt: string;
}
```

```ts
export function calculateGrossMargin(input: { revenue: number; cost: number }): number | null {
  if (input.revenue <= 0 || input.cost < 0 || input.cost > input.revenue) return null;
  return Number(((input.revenue - input.cost) / input.revenue).toFixed(4));
}

export function calculateRoi(input: { grossProfit: number; promotionSpend: number }): number | null {
  if (input.promotionSpend <= 0) return null;
  return Number((input.grossProfit / input.promotionSpend).toFixed(4));
}
```

- [ ] **Step 4: Run tests and type checking**

Run: `pnpm --filter @restaurant-ops/domain test && pnpm --filter @restaurant-ops/domain typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the domain package**

```bash
git add packages/domain packages/api-contract
git commit -m "feat: add enterprise restaurant domain types"
```

### Task 3: Implement the API with enterprise isolation and entitlement checks

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/auth/session.ts`
- Create: `apps/api/src/auth/require-enterprise.ts`
- Create: `apps/api/src/modules/enterprises/routes.ts`
- Create: `apps/api/src/modules/stores/routes.ts`
- Create: `apps/api/src/modules/entitlements/service.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/test/enterprise-isolation.test.ts`

- [ ] **Step 1: Write failing multi-tenant authorization tests**

```ts
it("returns 404 when a member reads a store outside their enterprise", async () => {
  const response = await app.inject({
    method: "GET",
    url: `/v1/stores/${otherEnterpriseStoreId}`,
    headers: { authorization: `Bearer ${enterpriseAToken}` }
  });
  expect(response.statusCode).toBe(404);
});

it("blocks new AI jobs when the enterprise contract has expired", async () => {
  const response = await app.inject({ method: "POST", url: `/v1/stores/${storeId}/diagnoses` });
  expect(response.statusCode).toBe(403);
  expect(response.json()).toMatchObject({ code: "ENTITLEMENT_EXPIRED" });
});
```

- [ ] **Step 2: Run the authorization tests to verify failure**

Run: `pnpm --filter @restaurant-ops/api test enterprise-isolation.test.ts`

Expected: FAIL because routes and policy do not exist.

- [ ] **Step 3: Implement scoped access and entitlement policy**

```ts
export async function requireEnterpriseStore(request: FastifyRequest, storeId: string) {
  const membership = request.membership;
  const store = await storeRepository.findByIdAndEnterprise(storeId, membership.enterpriseId);
  if (!store) throw request.server.httpErrors.notFound();
  return store;
}

export function canCreateAiJob(entitlement: Entitlement, now = new Date()): boolean {
  return entitlement.status === "active" && new Date(entitlement.expiresAt) > now;
}
```

- [ ] **Step 4: Add database migration and audit tables**

Create tables for `enterprises`, `memberships`, `stores`, `store_fact_versions`, `store_tags`, `entitlements`, and `audit_events`. Every store-owned row must carry `enterprise_id`; foreign keys must prevent orphaned records.

- [ ] **Step 5: Run API tests, migrations, lint, and type checks**

Run: `pnpm --filter @restaurant-ops/api test && pnpm --filter @restaurant-ops/api lint && pnpm --filter @restaurant-ops/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the secured API foundation**

```bash
git add apps/api packages/api-contract infra/migrations
git commit -m "feat: add enterprise scoped API and entitlements"
```

### Task 4: Build store onboarding and fact confirmation on Android

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/app/RestaurantOpsApplication.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/onboarding/StoreOnboardingScreen.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/onboarding/StoreOnboardingViewModel.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/onboarding/StoreFactDraft.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/network/RestaurantOpsApi.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/onboarding/StoreOnboardingViewModelTest.kt`

- [ ] **Step 1: Write failing onboarding validation tests**

```kotlin
@Test
fun `cannot submit until all four onboarding sections are valid`() {
    val incomplete = StoreFactDraft(storeName = "望江小馆", businessType = BusinessType.CHINESE_DINING)
    assertFalse(incomplete.isReadyForDiagnosis)

    val complete = incomplete.copy(averageSpendCents = 6800, currentGoal = "提升工作日晚餐套餐核销")
    assertTrue(complete.isReadyForDiagnosis)
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./gradlew -p apps/android testDebugUnitTest --tests '*StoreOnboardingViewModelTest'`

Expected: FAIL because `StoreFactDraft` does not exist.

- [ ] **Step 3: Implement a four-step, resumable onboarding flow**

```kotlin
enum class OnboardingStep { BASICS, POSITIONING, OPERATIONS, GOAL }

data class StoreFactDraft(
    val storeName: String = "",
    val businessType: BusinessType? = null,
    val averageSpendCents: Int? = null,
    val currentGoal: String = ""
) {
    val isReadyForDiagnosis: Boolean
        get() = storeName.isNotBlank() && businessType != null && averageSpendCents != null && currentGoal.isNotBlank()
}
```

The Compose screen must show progress, allow saving a local draft through `SavedStateHandle`, and only enable “完成建档” when the API-required fields are valid. The completed payload is posted to `POST /v1/stores/:storeId/facts` and then displayed as a read-only confirmed version.

- [ ] **Step 4: Run unit tests and an Android debug build**

Run: `./gradlew -p apps/android testDebugUnitTest assembleDebug`

Expected: PASS.

- [ ] **Step 5: Commit onboarding**

```bash
git add apps/android
git commit -m "feat: add required store onboarding on android"
```

### Task 5: Implement import confirmation, weekly diagnosis, and tasks

**Files:**
- Create: `apps/api/src/modules/imports/normalize.ts`
- Create: `apps/api/src/modules/imports/routes.ts`
- Create: `apps/api/src/modules/diagnoses/service.ts`
- Create: `apps/api/src/modules/diagnoses/routes.ts`
- Create: `apps/api/src/modules/tasks/routes.ts`
- Create: `apps/api/test/diagnosis-flow.test.ts`
- Create: `apps/android/app/src/main/java/com/restaurantops/diagnosis/WeeklyDiagnosisScreen.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/tasks/TaskListScreen.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/diagnosis/WeeklyDiagnosisViewModelTest.kt`

- [ ] **Step 1: Write a failing diagnosis flow test**

```ts
it("creates a report in the required review-first order with no more than three tasks", async () => {
  const diagnosis = await diagnosisService.create({ storeId, period, confirmedMetricIds });
  expect(diagnosis.sections.map(section => section.kind)).toEqual([
    "data_quality", "previous_week_review", "current_diagnosis", "weekly_direction", "actions"
  ]);
  expect(diagnosis.actions.length).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @restaurant-ops/api test diagnosis-flow.test.ts`

Expected: FAIL because the diagnosis service is absent.

- [ ] **Step 3: Implement confirmed-only input and structured diagnosis output**

```ts
export interface DiagnosisAction {
  title: string;
  ownerMemberId: string;
  dueDate: string;
  successMetric: string;
  completionCriteria: string;
}

export interface Finding {
  facts: string[];
  hypotheses: string[];
  confidence: "low" | "medium" | "high";
  evidenceMetricIds: string[];
}

export interface PreviousWeekReview {
  taskId: string;
  classification: "effective" | "ineffective" | "not_executed" | "insufficient_data";
  explanation: string;
}

export interface WeeklyDiagnosis {
  dataQuality: { completeness: number; missingFields: string[] };
  previousWeekReview: PreviousWeekReview | null;
  findings: Finding[];
  weeklyDirection: { statement: string; evidenceMetricIds: string[] };
  actions: DiagnosisAction[];
}
```

Reject an AI result unless it references only confirmed metric IDs, separates `facts` from `hypotheses`, contains at most three actions, and includes an evidence list for the weekly direction. First-week reports must set `previousWeekReview` to `null` rather than fabricate a review.

- [ ] **Step 4: Implement user confirmation for imported data**

`POST /v1/stores/:storeId/imports` stores raw files and extracted field candidates. `POST /v1/imports/:importId/confirm` writes versioned confirmed metrics. A diagnosis query selects only metrics with `confirmation_status = 'confirmed'`.

- [ ] **Step 5: Implement task completion and next-week review linkage**

Create tasks from accepted diagnosis actions. A task may be `open`, `completed`, `blocked`, or `cancelled`; completion requires a result note. The next diagnosis classifies prior tasks as effective, ineffective, not executed, or insufficient data.

- [ ] **Step 6: Run the full contract, API, and Android suite**

Run: `pnpm test && ./gradlew -p apps/android testDebugUnitTest`

Expected: PASS with no cross-enterprise access, no unconfirmed metric in a diagnosis, and no report with more than three actions.

- [ ] **Step 7: Commit the first usable vertical slice**

```bash
git add apps/api apps/android packages/domain packages/api-contract infra/migrations
git commit -m "feat: deliver weekly diagnosis and task loop"
```

### Task 6: Verify the phase against business acceptance scenarios

**Files:**
- Create: `docs/architecture/phase-1-acceptance.md`
- Create: `apps/api/test/fixtures/chinese-dining-weekly-case.json`
- Create: `apps/api/test/fixtures/tea-coffee-weekly-case.json`

- [ ] **Step 1: Add two golden restaurant cases**

Each fixture must include a confirmed fact version, confirmed weekly metrics, one prior task, expected diagnosis order, an evidence-backed direction, and up to three actions.

- [ ] **Step 2: Add an end-to-end acceptance test**

```ts
it("allows a signed-in enterprise manager to complete onboarding, confirm metrics, create a diagnosis, and close a task", async () => {
  // Seed enterprise and active entitlement, then exercise the public API in order.
  expect(result.weeklyDirection.evidenceMetricIds.length).toBeGreaterThan(0);
  expect(result.actions.length).toBeLessThanOrEqual(3);
});
```

- [ ] **Step 3: Run the acceptance suite**

Run: `pnpm --filter @restaurant-ops/api test -- --runInBand`

Expected: PASS for both supported fixture cases.

- [ ] **Step 4: Commit the acceptance baseline**

```bash
git add apps/api/test/fixtures apps/api/test docs/architecture
git commit -m "test: add phase one restaurant acceptance cases"
```

## Plan self-review

Coverage: this plan implements enterprise authorization, external enterprise entitlement records, four-step store onboarding, confirmed data imports, review-first weekly diagnosis, three-action tasks, isolation, cost-ready boundaries, and acceptance tests. It deliberately leaves video production, operator tooling, and App Store release automation to the three named follow-on plans because each is independently deployable.

No placeholders: commands, target paths, data structures, test cases, and commit boundaries are concrete. The plan does not require model API keys in the Android App, and it never adds a WeChat purchase or renewal call-to-action inside the mobile App.

Type consistency: `EnterpriseId`, `StoreId`, `StoreFactVersion`, `StoreTag`, `DiagnosisAction`, and `WeeklyDiagnosis` are defined in the domain/API tasks before later routes or Android screens consume them.
