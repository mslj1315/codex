# Android Operations Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a read-only Operations tab to the Android workspace using the independent operations API, without fabricated online data.

**Architecture:** Add a persisted `OPERATIONS` workspace tab. Use `OperationsRuntime` to choose the existing HTTP repository only for a valid Debug local API URL; otherwise use a typed unavailable repository. Keep `OperationsViewModel` as the atomic UI state boundary, and render only its public operation models.

**Tech Stack:** Kotlin, Jetpack Compose Material 3, Lifecycle ViewModel, Retrofit, Gson, coroutines, JUnit 4.

---

## File Map

- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceModels.kt`: add `OPERATIONS` tab.
- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`: instantiate runtime and route tab.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt`: add API gate and unavailable source.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt`: add read-only Compose UI.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsViewModel.kt`: add verification-summary state.
- `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt`: tab-restoration test.
- `apps/android/app/src/test/java/com/restaurantops/operations/OperationsRuntimeTest.kt`: runtime test.
- `apps/android/app/src/test/java/com/restaurantops/operations/OperationsViewModelTest.kt`: summary and error retention tests.

### Task 1: Add the Persisted Navigation Entry

**Files:** Modify `WorkspaceModels.kt`; modify `WorkspaceViewModelTest.kt`.

- [ ] Write this failing test:

```kotlin
@Test
fun `operations tab is restored after workspace recreation`() {
    val handle = SavedStateHandle()
    WorkspaceViewModel(handle).selectTab(WorkspaceTab.OPERATIONS)
    assertEquals(WorkspaceTab.OPERATIONS, WorkspaceViewModel(handle).selectedTab)
}
```

- [ ] Run `..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.workspace.WorkspaceViewModelTest' '--no-daemon' '--console=plain'`.

Expected: compile fails because `OPERATIONS` does not exist.

- [ ] Insert the enum value after `HOME`:

```kotlin
OPERATIONS("经营", "operations"),
```

Keep unknown persisted values mapped to `HOME`. Re-run the preceding Gradle command; expect green. Commit with `feat(android): add operations workspace tab`.

### Task 2: Gate the Independent Operations Runtime

**Files:** Create `OperationsRuntime.kt`; create `OperationsRuntimeTest.kt`.

- [ ] Write failing tests:

```kotlin
@Test
fun `debug local API configuration enables HTTP operations`() {
    assertTrue(OperationsRuntime.canUseHttpRepository(true, "http://10.0.2.2:3000/"))
    assertFalse(OperationsRuntime.canUseHttpRepository(false, "http://10.0.2.2:3000/"))
}

@Test
fun `unavailable runtime has no invented operations data`() = runTest {
    val error = assertFailsWith<OperationsRequestException> {
        UnavailableOperationsRepository().loadReadiness("store_demo", "2026-08-01", "2026-08-07")
    }
    assertEquals(0, error.statusCode)
    assertEquals("Unable to reach the operations service", error.message)
}
```

- [ ] Run `..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.operations.OperationsRuntimeTest' '--no-daemon' '--console=plain'` and confirm compile-red.

- [ ] Implement:

```kotlin
object OperationsRuntime {
    fun canUseHttpRepository(isDebug: Boolean, baseUrl: String): Boolean =
        LocalImportApiRuntime.canUseLocalApi(isDebug, baseUrl)

    fun repository(isDebug: Boolean, baseUrl: String): OperationsRepository =
        if (canUseHttpRepository(isDebug, baseUrl)) HttpOperationsRepository(
            Retrofit.Builder().baseUrl(baseUrl)
                .addConverterFactory(GsonConverterFactory.create())
                .build().create(OperationsApi::class.java)
        ) else UnavailableOperationsRepository()
}
```

`UnavailableOperationsRepository` must implement each repository call by throwing
`OperationsServiceUnavailableException`; it holds no sample data and calls no
network code. Add private-set `isServiceUnavailable` state in
`OperationsViewModel`; catch this exception before `OperationsRequestException`
and set that state without presenting a network failure. Re-run green and commit
with `feat(android): gate operations API runtime`.

### Task 3: Load Verification Summaries in the ViewModel

**Files:** Modify `OperationsViewModel.kt`; modify `OperationsViewModelTest.kt`.

- [ ] Add failing tests that invoke `loadVerificationSummary("store_demo", "action_1")`, await idle, and assert `selectedActionCardId` plus `verificationSummary`; then configure a 503 private failure and assert the previous summary remains with neutral `Unable to load operations data`.

- [ ] Run `..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.operations.OperationsViewModelTest' '--no-daemon' '--console=plain'` and confirm red.

- [ ] Add private-set state and a loading action:

```kotlin
var selectedActionCardId by mutableStateOf<String?>(null)
    private set
var verificationSummary by mutableStateOf<ActionVerificationSummary?>(null)
    private set

fun loadVerificationSummary(storeId: String, actionCardId: String) {
    if (isLoading) return
    isLoading = true
    requestError = null
    operationScope.launch {
        try {
            val loaded = repository.loadVerificationSummary(storeId, actionCardId)
            selectedActionCardId = actionCardId
            verificationSummary = loaded
        } catch (error: CancellationException) {
            throw error
        } catch (error: OperationsRequestException) {
            requestError = neutralMessage(error)
        } catch (_: Throwable) {
            requestError = FAILURE_MESSAGE
        } finally {
            isLoading = false
        }
    }
}
```

Extract the current status-code mapping into `neutralMessage`. A successful main `load` clears selected card and summary before publishing its complete new snapshot. Re-run green and commit with `feat(android): load action verification summaries`.

### Task 4: Render and Wire the Operations Tab

**Files:** Create `OperationsScreen.kt`; modify `WorkspaceScreens.kt`.

- [ ] Create this public composable and use an effect for the initial load:

```kotlin
@Composable
fun OperationsScreen(
    viewModel: OperationsViewModel,
    storeId: String,
    rangeStart: String,
    rangeEnd: String,
    modifier: Modifier = Modifier
) {
    LaunchedEffect(storeId, rangeStart, rangeEnd) {
        viewModel.load(storeId, rangeStart, rangeEnd)
    }
}
```

- [ ] Render a scrollable operational surface: icon-only refresh button with tooltip, a distinct service-not-configured state when `isServiceUnavailable` is true, neutral loading/error state for real request failures, readiness confidence/missing metrics, diagnosis or explicit no-diagnosis, action-card title/status rows, and public verification metrics after a card selection. The page creates or changes no cards.

- [ ] In `WorkspaceRoot`, remember `OperationsRuntime.repository(BuildConfig.DEBUG, BuildConfig.LOCAL_API_BASE_URL)` and its ViewModel. Route the new tab to the screen with `store_demo`, `2026-08-01`, and `2026-08-07`. The unavailable source must show neutral connection state only, never demo results.

- [ ] Run the complete Android verification:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' ':apps:android:app:assembleDebug' ':apps:android:app:assembleRelease' '--no-daemon' '--console=plain'
```

Expected: all tests and both APK variants pass. Commit with `feat(android): render operations workspace`.

### Task 5: Final Verification and Delivery

**Files:** Modify only code needed to correct a verified defect.

- [ ] Re-run Task 4 verification, then run `git diff --check` and `git status --short`; expect exit 0 and only plan/navigation/runtime/ViewModel/screen/test changes.

- [ ] Push with `git push origin feature/android-import-api`; ensure no POS, ERP, delivery-platform, or restaurant-system configuration is included.
