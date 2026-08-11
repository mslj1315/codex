# Android Local Import API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect Android Emulator manual import and confirmation to the local Docker API without exposing transport concerns to Compose.

**Architecture:** Keep `ImportRepository` as the domain boundary. A Retrofit service and DTO mapper live in `imports/network`, while `HttpImportRepository` converts HTTP responses to current import models. Debug builds use `http://10.0.2.2:3000/`; the Docker API itself remains bound to host loopback.

**Tech Stack:** Kotlin, Retrofit 2, Gson converter, OkHttp, Kotlin coroutines, Jetpack Compose, JUnit 4, Android Emulator, Docker Compose.

---

## File Map

- `apps/android/app/build.gradle.kts`: Retrofit, Gson, and coroutine dependencies; debug API URL build config.
- `apps/android/app/src/main/AndroidManifest.xml`: Android internet permission.
- `apps/android/app/src/main/java/com/restaurantops/imports/ImportRepository.kt`: suspend repository contract and latest-facts read.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt`: Retrofit endpoint declarations and wire DTOs.
- `apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt`: DTO/domain mapper and status-aware HTTP failures.
- `apps/android/app/src/main/java/com/restaurantops/imports/ImportViewModel.kt`: coroutine loading/error state and server-backed actions.
- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`: create the debug HTTP repository instead of the local demo repository.
- `apps/android/app/src/test/java/com/restaurantops/imports/HttpImportRepositoryTest.kt`: mapping/request tests with a fake API service.
- `apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt`: asynchronous ready-only confirmation and error-state tests.

### Task 1: Add Debug Network Boundary

**Files:** Modify `apps/android/app/build.gradle.kts`, `apps/android/app/src/main/AndroidManifest.xml`; create `apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt`.

- [ ] **Step 1: Write the failing API-contract test**

```kotlin
@Test fun `manual endpoint stays store scoped`() {
    assertEquals("v1/stores/{storeId}/imports/manual", ImportApiContract.manualImportPath)
}
```

- [ ] **Step 2: Verify red**

Run:

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.imports.HttpImportRepositoryTest' '--no-daemon'
```

Expected: compilation fails because `ImportApiContract` does not exist.

- [ ] **Step 3: Add minimum network configuration**

Add dependencies:

```kotlin
implementation("com.squareup.retrofit2:retrofit:2.11.0")
implementation("com.squareup.retrofit2:converter-gson:2.11.0")
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
```

Add `buildConfigField("String", "LOCAL_API_BASE_URL", "\"http://10.0.2.2:3000/\"")`, enable `buildFeatures.buildConfig`, and add `<uses-permission android:name="android.permission.INTERNET" />` before `<application>`.

Define the service contract with suspend endpoints:

```kotlin
interface ImportApi {
    @POST("v1/stores/{storeId}/imports/manual")
    suspend fun createManual(@Path("storeId") storeId: String, @Body body: ManualImportRequest): ImportSummaryResponse
}
```

Keep all DTO classes in this file and never include enterprise, actor, password, token, or API-key fields.

- [ ] **Step 4: Verify green**

Run the focused command from Step 2. Expected: test passes and the app compiles.

- [ ] **Step 5: Commit**

```powershell
git add apps/android/app/build.gradle.kts apps/android/app/src/main/AndroidManifest.xml apps/android/app/src/main/java/com/restaurantops/imports/network/ImportApi.kt apps/android/app/src/test/java/com/restaurantops/imports/HttpImportRepositoryTest.kt
git commit -m "feat(android): add local import API contract"
```

### Task 2: Implement HTTP Repository Mapping

**Files:** Modify `apps/android/app/src/main/java/com/restaurantops/imports/ImportRepository.kt`; create `apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt`; modify `HttpImportRepositoryTest.kt`.

- [ ] **Step 1: Write failing mapping and request tests**

```kotlin
@Test fun `maps a ready cents candidate from API`() = runTest {
    val repository = HttpImportRepository(FakeImportApi(summaryResponse(status = "ready", unit = "cents")))
    val summary = repository.loadImport("store_demo", "batch_1")

    assertEquals(ImportCandidateStatus.READY, summary.candidates.single().status)
    assertEquals(4826000L, summary.candidates.single().value)
}

@Test fun `confirmation sends supplied candidate ids only`() = runTest {
    val api = RecordingImportApi()
    HttpImportRepository(api).confirm("store_demo", "batch_1", listOf("ready_1"))

    assertEquals(listOf("ready_1"), api.confirmRequest.candidateIds)
}
```

- [ ] **Step 2: Verify red**

Run the Task 1 focused command. Expected: `HttpImportRepository` is unresolved.

- [ ] **Step 3: Implement the suspend repository**

Change every `ImportRepository` method to `suspend` and add:

```kotlin
suspend fun loadLatestFacts(storeId: String): FactVersion
```

`HttpImportRepository` maps API `sourceType`, candidate status, values, range, confidence, and issue code to domain models. Map non-2xx HTTP responses to a typed `ImportRequestException(statusCode, message)`. `updateCandidate` sends only editable fields, and `confirm` sends only the caller-provided candidate IDs.

- [ ] **Step 4: Verify green**

Run the focused command. Expected: mapping and request tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/android/app/src/main/java/com/restaurantops/imports/ImportRepository.kt apps/android/app/src/main/java/com/restaurantops/imports/network/HttpImportRepository.kt apps/android/app/src/test/java/com/restaurantops/imports/HttpImportRepositoryTest.kt
git commit -m "feat(android): add HTTP import repository"
```

### Task 3: Make Import State Asynchronous

**Files:** Modify `apps/android/app/src/main/java/com/restaurantops/imports/ImportViewModel.kt`, `apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt`, and the fake repositories in that test.

- [ ] **Step 1: Write failing error and confirmation tests**

```kotlin
@Test fun `confirmation sends only ready ids through the repository`() = runTest {
    val repository = RecordingRepository(summaryWithReadyAndUnresolved)
    val viewModel = ImportViewModel(repository)
    viewModel.load("store_demo", "import_1")
    viewModel.confirmReady("store_demo")
    advanceUntilIdle()

    assertEquals(listOf("candidate_ready"), repository.confirmedIds)
}

@Test fun `validation failure is shown without discarding the batch`() = runTest {
    val viewModel = ImportViewModel(FailingRepository(ImportRequestException(422, "rangeStart is required")))
    viewModel.load("store_demo", "import_1")
    viewModel.confirmReady("store_demo")
    advanceUntilIdle()

    assertEquals("rangeStart is required", viewModel.requestError)
    assertNotNull(viewModel.summary)
}
```

- [ ] **Step 2: Verify red**

Run:

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.imports.ImportViewModelTest' '--no-daemon'
```

Expected: compilation fails because repository calls are still synchronous or `requestError` is absent.

- [ ] **Step 3: Implement minimal asynchronous state**

Use `viewModelScope.launch` for repository calls. Add private-set `isLoading` and `requestError` properties. Clear errors on new user actions, retain `summary` after failures, block duplicate actions while loading, and map `ImportRequestException` messages directly. Keep the existing ready-only bulk selection and read-only confirmation rules.

- [ ] **Step 4: Verify green**

Run the focused command from Step 2. Expected: all import ViewModel tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/android/app/src/main/java/com/restaurantops/imports/ImportViewModel.kt apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt
git commit -m "feat(android): handle import API state"
```

### Task 4: Wire the Debug UI and Runtime States

**Files:** Modify `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`, `apps/android/app/src/main/java/com/restaurantops/imports/ImportScreens.kt`.

- [ ] **Step 1: Wire the implementation**

Create Retrofit with `BuildConfig.LOCAL_API_BASE_URL` in `WorkspaceRoot` and inject `HttpImportRepository`. In `ImportScreens`, show request progress while `isLoading`, disable command buttons while loading, and render `requestError` without erasing the current summary. Do not change CSV/XLSX placeholder copy or introduce a file picker.


- [ ] **Step 2: Verify the existing state tests and UI compilation**

Run the Task 3 focused command. Expected: tests pass and app compiles.

- [ ] **Step 3: Commit**

```powershell
git add apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/main/java/com/restaurantops/imports/ImportScreens.kt apps/android/app/src/test/java/com/restaurantops/imports/ImportViewModelTest.kt
git commit -m "feat(android): connect import screen to local API"
```

### Task 5: Verify Emulator and Local Stack

**Files:** Modify only files where verification exposes a defect.

- [ ] **Step 1: Run full code verification**

```powershell
Set-Location services/api
npm test
npm run typecheck
Set-Location ..\..
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' ':apps:android:app:assembleDebug' '--no-daemon'
```

Expected: API tests, typecheck, Android unit tests, and debug APK build pass.

- [ ] **Step 2: Verify Docker remains local-only**

```powershell
$cliExe='C:\Program Files\Docker\Docker\resources\bin\docker.exe'
& $cliExe compose --env-file .env.example ps
```

Expected: API displays `127.0.0.1:3000->3000/tcp`.

- [ ] **Step 3: Verify through Android Emulator**

Start an Android Emulator, install the Debug APK, create a manual `orders` candidate, confirm it, and reload the newest fact version. Expected: the app reaches the Docker API via `10.0.2.2`, returns the server-generated fact version, and does not include unresolved candidates.

- [ ] **Step 4: Verify and push the completed branch**

```powershell
git diff --check
git push
```
