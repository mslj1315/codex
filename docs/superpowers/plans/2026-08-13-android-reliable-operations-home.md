# Android Reliable Operations Home Implementation Plan

> **For the implementation agent:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Turn the authenticated Android Home tab into a reliable daily operations entry point that uses the latest confirmed import period, guides staff to import when no usable period exists, and opens the existing operations workflow on the exact same period.

**Architecture:** Add a privacy-safe API endpoint that resolves the caller's trusted scope and returns only the latest confirmed period metadata. In Android, a small home data source fetches that period through the existing authenticated Retrofit client; `OperationsHomeViewModel` then loads the existing readiness, deterministic diagnostic, and action-card data concurrently for that period. The remote Home screen renders explicit loading/current/stale/missing/failure states, while the local demo keeps its existing static Home experience. A selected Home period is saved in `WorkspaceViewModel` and becomes the input to the existing Operations screen, replacing its fixed sample dates.

**Tech Stack:** Fastify, PostgreSQL, pg, Vitest, Kotlin, AndroidX ViewModel/SavedStateHandle, Jetpack Compose, Retrofit, Kotlin coroutines, JUnit.

---

### Task 1: Expose the latest confirmed period from the API

**Files:**
- Modify: `services/api/src/imports/repository.ts`
- Modify: `services/api/src/imports/service.ts`
- Modify: `services/api/src/imports/routes.ts`
- Modify: `services/api/test/import-routes.test.ts`

**Step 1: Write the failing route contract tests**

Add cases to the import route test suite that authenticate a store member and verify:

- `GET /v1/stores/:storeId/operations/latest-confirmed-period` returns the latest confirmed batch/fact-version period as `{ period: { rangeStart, rangeEnd, confirmedAt } }`.
- Two confirmed periods return the newest confirmation, not the newer import or arbitrary row.
- A store with no confirmed fact data returns `{ period: null }` with HTTP 200.
- A caller cannot read another enterprise/store's period, following the existing trusted-context route behavior.
- The serialised response has exactly `period`, `rangeStart`, `rangeEnd`, and `confirmedAt`; it never contains batch IDs, fact IDs, source data, object keys, or raw metric values.

Run: `npm test -- --run test/import-routes.test.ts`

Expected: FAIL because the endpoint and repository method do not exist.

**Step 2: Add the narrow repository read model and query**

In `services/api/src/imports/repository.ts`:

- Add an exported `LatestConfirmedPeriod` type containing only `rangeStart`, `rangeEnd`, and `confirmedAt`.
- Add `getLatestConfirmedPeriod(scope)` that scopes on `enterprise_id` and `store_id`, joins the existing confirmed fact-version/import-batch persistence tables, filters to confirmed usable import facts, and orders by the confirmation timestamp descending with a deterministic tie-breaker.
- Return `null` when no eligible row exists.
- Convert database timestamps with the existing repository date helpers, and keep the SQL result projection limited to the three public fields.

**Step 3: Keep service and route ownership explicit**

In `services/api/src/imports/service.ts`, add a thin `getLatestConfirmedPeriod(context)` method that delegates with `enterpriseId` and `storeId` from trusted context.

In `services/api/src/imports/routes.ts`:

- Register the GET route beside the authenticated store-scoped operations/readiness routes.
- Reuse the existing store ID validation and context resolver.
- Return `{ period }` directly; do not accept a caller-supplied enterprise ID or date range.

**Step 4: Run the targeted API tests**

Run: `npm test -- --run test/import-routes.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add services/api/src/imports/repository.ts services/api/src/imports/service.ts services/api/src/imports/routes.ts services/api/test/import-routes.test.ts
git commit -m "feat(api): expose latest confirmed operations period"
```

### Task 2: Add Android latest-period HTTP contract and repository

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeApi.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeRepository.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/home/HttpOperationsHomeRepositoryTest.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt`

**Step 1: Write failing repository tests**

Create HTTP/repository tests using a fake `OperationsHomeApi` that assert:

- A non-null wire response maps to a domain `ConfirmedOperationsPeriod` with only range start, range end, and confirmation time.
- A null period maps to a normal `null` result, not a transport failure.
- HTTP and I/O failures map to a typed, non-sensitive home request error with status code semantics matching `OperationsRequestException`.
- Malformed/unknown wire content fails locally and does not fabricate a period.

Run: `./gradlew.bat :app:testDebugUnitTest --tests "com.restaurantops.home.HttpOperationsHomeRepositoryTest" --rerun-tasks`

Expected: FAIL because the home API and repository do not exist.

**Step 2: Implement the Retrofit contract and mapping boundary**

In `OperationsHomeApi.kt`:

- Define `GET /v1/stores/{storeId}/operations/latest-confirmed-period` with a `LatestConfirmedPeriodResponse` wrapper whose `period` is nullable.
- Keep the DTO limited to `rangeStart`, `rangeEnd`, and `confirmedAt`.

In `OperationsHomeRepository.kt`:

- Define `ConfirmedOperationsPeriod` and an `OperationsHomeRepository` interface with `loadLatestConfirmedPeriod(storeId)`.
- Implement `HttpOperationsHomeRepository`, converting Retrofit `HttpException` and `IOException` to a typed `OperationsHomeRequestException` with neutral messages.
- Validate `YYYY-MM-DD` range values before exposing a period to UI code; pass ISO confirmation time through as display metadata only.

In `OperationsRuntime.kt`, add an authenticated factory method that constructs this repository from the existing `AuthenticatedApiClient` Retrofit instance. Do not create another token store, interceptor, or base URL path.

**Step 3: Run the focused unit tests**

Run: `./gradlew.bat :app:testDebugUnitTest --tests "com.restaurantops.home.HttpOperationsHomeRepositoryTest" --rerun-tasks`

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeApi.kt apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeRepository.kt apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt apps/android/app/src/test/java/com/restaurantops/home/HttpOperationsHomeRepositoryTest.kt
git commit -m "feat(android): add confirmed operations period source"
```

### Task 3: Model reliable remote Home state and concurrent operations loading

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeViewModel.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/home/OperationsHomeViewModelTest.kt`

**Step 1: Write failing ViewModel tests**

Write coroutine tests for a fake latest-period repository and fake existing `OperationsRepository`. Cover:

- Current confirmation (at most 30 days old) loads readiness, diagnostic, and open action cards for exactly the returned range.
- Stale confirmation (older than 30 days) preserves and displays its known period while signalling that import is needed.
- No confirmed period transitions directly to `MissingData` and does not invoke any readiness/diagnostic/action-card request.
- Latest-period failure yields a retryable unavailable state with neutral copy and no stale fabricated content.
- After a valid period is found, the three existing operations requests start concurrently; an absent diagnosis is normal, while an individual request failure produces a retryable failure state.
- Reload/retry replaces the state for the active store and never mixes values from a previous store.

Run: `./gradlew.bat :app:testDebugUnitTest --tests "com.restaurantops.home.OperationsHomeViewModelTest" --rerun-tasks`

Expected: FAIL because the ViewModel does not exist.

**Step 2: Implement the state machine**

Create a UI model with explicit states:

- `Loading`
- `Current(period, readiness, diagnostic, actionCards)`
- `Stale(period, readiness, diagnostic, actionCards)`
- `MissingData`
- `Failure(retryable)`

Implement `OperationsHomeViewModel` with an injected clock (for deterministic 30-day freshness tests), `OperationsHomeRepository`, `OperationsRepository`, and coroutine scope/dispatcher matching existing `OperationsViewModel` conventions.

After a period is returned, use `coroutineScope` and `async` to request `loadReadiness`, `loadDeterministicDiagnostic`, and the existing unfiltered `loadActionCards` concurrently for the exact returned range. Locally retain only actionable `proposed` and `in_progress` cards because the current server contract has no `open` status. Preserve the existing operations models rather than duplicating diagnostics or verification behavior.

**Step 3: Run focused ViewModel tests**

Run: `./gradlew.bat :app:testDebugUnitTest --tests "com.restaurantops.home.OperationsHomeViewModelTest" --rerun-tasks`

Expected: PASS.

**Step 4: Commit**

```bash
git add apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeViewModel.kt apps/android/app/src/test/java/com/restaurantops/home/OperationsHomeViewModelTest.kt
git commit -m "feat(android): model reliable operations home state"
```

### Task 4: Render remote Home states and use the selected period in Operations

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeScreen.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/home/OperationsHomeScreenTest.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceViewModel.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt`
- Modify: `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt`

**Step 1: Write failing UI and navigation-state tests**

Add Compose/UI-model tests that verify:

- Current state shows the confirmed date range, a current status label, readiness/diagnostic/action-card summaries, and a `View operations` command.
- Stale state shows the last confirmed date range and an import call to action without hiding the known operational snapshot.
- Missing state explains that confirmed data is required and has only the import action; it does not show invented scores, tasks, diagnosis, or sample data.
- Loading and failure states have an accessible retry action and neutral messages with no backend/internal error text.
- The import call-to-action triggers the existing `WorkspaceViewModel.openImport()` path.
- Selecting `View operations` saves the exact range, selects `WorkspaceTab.OPERATIONS`, and causes `OperationsScreen` to load that range instead of the legacy fixed sample dates.

Run:

```bash
./gradlew.bat :app:testDebugUnitTest --tests "com.restaurantops.home.OperationsHomeScreenTest" --tests "com.restaurantops.workspace.WorkspaceViewModelTest" --tests "com.restaurantops.operations.OperationsScreenTest" --rerun-tasks
```

Expected: FAIL because the remote Home composable and selected-period navigation state do not exist.

**Step 2: Implement the Home composable**

Create `OperationsHomeScreen` as a compact operational surface, not a marketing/dashboard mock:

- Render the explicit ViewModel states with stable, practical Chinese copy.
- Display only server-backed period/readiness/diagnostic/action-card summaries; do not retain the local demo's fabricated operational figures in the remote view.
- Use the existing import overlay callback for missing/stale data.
- Provide an icon or text command for retry where appropriate and a `View operations` command only when a period exists.

Keep the existing `HomeScreen` private/local-demo path intact so unauthenticated demo behavior remains intentional and separate.

**Step 3: Persist and consume the selected range**

In `WorkspaceViewModel`:

- Add a small saved-state-backed selected operations range model.
- Add `openOperations(rangeStart, rangeEnd)` that validates the range, saves it, closes any overlay, and selects the operations tab.
- Expose the selected range to `WorkspaceRoot` without storing any raw operational data.

In `WorkspaceScreens.kt`:

- Construct the authenticated home repository and view model only when `authenticatedApiClient` is present.
- Render `OperationsHomeScreen` for authenticated Home and retain the existing local `HomeScreen` for local demo.
- Wire import/retry/view-operations callbacks to the workspace view model.
- Pass the selected range to the existing `OperationsScreen`; when no range has been selected, render a concise empty/import-guidance state rather than querying the old fixed sample dates.

In `OperationsScreen.kt`, support the nullable selected range and show the same period context near the screen title. Only issue `viewModel.load` when both dates are present.

**Step 4: Run focused Android tests**

Run:

```bash
./gradlew.bat :app:testDebugUnitTest --tests "com.restaurantops.home.OperationsHomeScreenTest" --tests "com.restaurantops.workspace.WorkspaceViewModelTest" --tests "com.restaurantops.operations.OperationsScreenTest" --rerun-tasks
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/android/app/src/main/java/com/restaurantops/home/OperationsHomeScreen.kt apps/android/app/src/test/java/com/restaurantops/home/OperationsHomeScreenTest.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceViewModel.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt
git commit -m "feat(android): make home the reliable operations entry"
```

### Task 5: Record the delivered boundary and verify the complete vertical slice

**Files:**
- Modify: `docs/project-progress.md`
- Modify: `docs/gap-analysis.md`
- Modify: `README.md`

**Step 1: Update delivery documentation**

Document that:

- Authenticated Android Home uses the latest confirmed server period and does not display hard-coded sample operational values.
- Missing/stale data sends the user to the existing import flow.
- The operation detail view is launched on the selected confirmed period.
- Provider web-console continuation remains intentionally deferred until Android reliable data states are verified.

Remove or correct obsolete claims that the Android authenticated workflow is incomplete.

**Step 2: Run all API verification**

Run from `services/api`:

```bash
npm test
npm run typecheck
npm audit --audit-level=high
```

Expected: all tests and typecheck pass; report any pre-existing moderate audit advisories without changing dependencies outside scope.

**Step 3: Run all Android verification**

Run from `apps/android`:

```bash
./gradlew.bat :app:testDebugUnitTest --rerun-tasks
./gradlew.bat :app:assembleDebug :app:assembleRelease
```

Expected: unit tests and both APK variants build successfully.

**Step 4: Verify diff and Compose configuration**

Run from repository root:

```bash
docker compose config --quiet
docker compose --profile maintenance config --quiet
git diff --check
git status --short
```

**Step 5: Commit and push the vertical slice**

```bash
git add docs/project-progress.md docs/gap-analysis.md README.md
git commit -m "docs: record reliable Android operations home"
git push origin feature/android-import-api
```

---

## Final Review Checklist

- [ ] The period endpoint is authenticated, context-scoped, deterministic, and exposes only period metadata.
- [ ] Android retries and 401 refresh reuse the existing authenticated client rather than a new auth path.
- [ ] Remote Home never renders fixed demo operations data.
- [ ] Missing data never triggers readiness/diagnostic/action-card requests.
- [ ] Stale data remains visible while clearly directing the user to import.
- [ ] `View operations` and the Operations tab use the same latest-confirmed range.
- [ ] The local demo remains a consciously separate path.
- [ ] API and Android test/build verification are green before push.
