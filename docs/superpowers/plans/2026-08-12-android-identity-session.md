# Android Identity Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Android app authenticate against the self-hosted identity API, retain only an encrypted refresh token, select an authorized store, and safely attach/refresh bearer credentials for remote workspace requests.

**Architecture:** A testable `auth` package owns session state, API DTOs, refresh-token persistence, and a Retrofit/OkHttp authentication boundary. UI receives an `AppSessionState` and can enter local demo independently from the remote authenticated workspace. The selected store belongs to the authenticated session and is supplied to imports and operations instead of the current hard-coded demo value.

**Tech Stack:** Kotlin, Jetpack Compose, lifecycle ViewModel, coroutines, Retrofit 2, OkHttp, AndroidX Security Crypto, JUnit 4, Android Compose UI test.

---

### Task 1: Define Pure Session Models And Login Validation

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/AuthModels.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/LoginViewModel.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/auth/LoginViewModelTest.kt`

- [ ] **Step 1: Write the failing login validation tests**

```kotlin
@Test fun blankCredentialsDoNotCallTheRepository() = runTest {
    val repository = FakeAuthRepository()
    val viewModel = LoginViewModel(repository)
    viewModel.loginName = " "
    viewModel.password = ""
    viewModel.submit()
    assertEquals(LoginUiState.Error("请输入账号和密码"), viewModel.uiState)
    assertEquals(0, repository.loginCalls)
}

@Test fun successfulLoginMovesToStoreSelection() = runTest {
    val repository = FakeAuthRepository(stores = listOf(StoreMembership("ent_a", "store_a", StoreRole.OWNER)))
    val viewModel = LoginViewModel(repository)
    viewModel.loginName = "owner"
    viewModel.password = "password"
    viewModel.submit()
    advanceUntilIdle()
    assertEquals(LoginUiState.Success, viewModel.uiState)
    assertEquals(listOf(StoreMembership("ent_a", "store_a", StoreRole.OWNER)), repository.loadedStores)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.LoginViewModelTest`

Expected: compilation failure because the auth models and LoginViewModel do not exist.

- [ ] **Step 3: Implement the minimal pure session models and ViewModel**

```kotlin
data class StoreMembership(val enterpriseId: String, val storeId: String, val role: StoreRole)
enum class StoreRole { OWNER, OPERATOR }
interface AuthRepository {
    suspend fun login(loginName: String, password: String): List<StoreMembership>
    suspend fun restore(): List<StoreMembership>
    suspend fun logout()
}
class LoginViewModel(private val repository: AuthRepository) : ViewModel() {
    var loginName by mutableStateOf("")
    var password by mutableStateOf("")
    var uiState by mutableStateOf<LoginUiState>(LoginUiState.Idle)
    fun submit() { /* reject blank fields, then launch login in viewModelScope */ }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.LoginViewModelTest`

Expected: PASS.

- [ ] **Step 5: Commit the pure login state**

```powershell
git add apps/android/app/src/main/java/com/restaurantops/auth apps/android/app/src/test/java/com/restaurantops/auth/LoginViewModelTest.kt
git commit -m "feat(android): add login session state"
```

### Task 2: Add Auth API And Encrypted Refresh-Token Port

**Files:**
- Modify: `apps/android/app/build.gradle.kts`
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/AuthApi.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/EncryptedRefreshTokenStore.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/auth/AuthRepositoryTest.kt`

- [ ] **Step 1: Write failing repository tests for login, restore, and logout cleanup**

```kotlin
@Test fun loginPersistsOnlyTheRefreshTokenAndLoadsStores() = runTest {
    val tokens = AuthTokens(accessToken = "access", refreshToken = "refresh", expiresAt = "2026-08-12T10:00:00Z")
    val store = FakeRefreshTokenStore()
    val repository = HttpAuthRepository(FakeAuthApi(tokens, listOf(storeMembership)), store)
    assertEquals(listOf(storeMembership), repository.login("owner", "secret"))
    assertEquals("refresh", store.value)
}

@Test fun logoutClearsStoredRefreshTokenEvenWhenTheNetworkCallFails() = runTest {
    val store = FakeRefreshTokenStore("refresh")
    val repository = HttpAuthRepository(FailingAuthApi(), store)
    assertFailsWith<AuthRequestException> { repository.logout() }
    assertNull(store.value)
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.AuthRepositoryTest`

Expected: compilation failure because AuthApi, HttpAuthRepository, and RefreshTokenStore do not exist.

- [ ] **Step 3: Add API DTOs and a storage interface with an encrypted Android adapter**

```kotlin
interface AuthApi {
    @POST("/v1/auth/login") suspend fun login(@Body body: LoginRequest): AuthTokensResponse
    @POST("/v1/auth/refresh") suspend fun refresh(@Body body: RefreshRequest): AuthTokensResponse
    @POST("/v1/auth/logout") suspend fun logout(): Response<Unit>
    @GET("/v1/auth/me/stores") suspend fun stores(): StoresResponse
}
interface RefreshTokenStore { fun read(): String?; fun write(token: String); fun clear() }
```

Use `EncryptedSharedPreferences` and a `MasterKey` in `EncryptedRefreshTokenStore`; persist the literal refresh token under one fixed key. Never persist access token, password, authorization header, or store list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.AuthRepositoryTest`

Expected: PASS.

- [ ] **Step 5: Commit auth transport and protected storage**

```powershell
git add apps/android/app/build.gradle.kts apps/android/app/src/main/java/com/restaurantops/auth apps/android/app/src/test/java/com/restaurantops/auth/AuthRepositoryTest.kt
git commit -m "feat(android): add encrypted auth session storage"
```

### Task 3: Attach Bearer Tokens And Serialize One Refresh Retry

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/AuthenticatedApiClient.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/auth/AuthenticatedApiClientTest.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`

- [ ] **Step 1: Write failing interceptor tests**

```kotlin
@Test fun requestCarriesAccessTokenAndRetriesOnceAfter401() {
    val session = FakeSessionGateway(accessToken = "old", refreshedAccessToken = "new")
    val result = executeThroughClient(session, responses = listOf(401, 200))
    assertEquals(200, result.code)
    assertEquals(listOf("Bearer old", "Bearer new"), result.authorizationHeaders)
    assertEquals(1, session.refreshCalls)
}

@Test fun concurrentUnauthorizedRequestsShareOneRefresh() { /* block refresh and assert one call */ }
@Test fun refreshFailureClearsSessionAndDoesNotRetryAgain() { /* assert cleared and 401 returned */ }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.AuthenticatedApiClientTest`

Expected: compilation failure because the authenticated client boundary does not exist.

- [ ] **Step 3: Implement one shared authenticated Retrofit factory**

```kotlin
class AuthenticatedApiClient(private val session: SessionGateway) {
    fun retrofit(baseUrl: String): Retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(OkHttpClient.Builder().addInterceptor(BearerInterceptor(session)).build())
        .addConverterFactory(GsonConverterFactory.create())
        .build()
}
```

The interceptor attaches `Authorization: Bearer <access token>` only when a session exists. On an initial `401`, it invokes a mutex-protected refresh operation and retries exactly once with the new token. It never retries login/refresh endpoints, never attempts refresh after a retry, and clears local session on refresh failure. Runtime factories use this shared Retrofit instance for both imports and operations.

- [ ] **Step 4: Run the test to verify it passes**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.AuthenticatedApiClientTest`

Expected: PASS.

- [ ] **Step 5: Commit the shared authenticated request boundary**

```powershell
git add apps/android/app/src/main/java/com/restaurantops/auth apps/android/app/src/main/java/com/restaurantops/operations/OperationsRuntime.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/test/java/com/restaurantops/auth/AuthenticatedApiClientTest.kt
git commit -m "feat(android): authenticate remote workspace requests"
```

### Task 4: Select Stores And Route App States

**Files:**
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/SessionViewModel.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/auth/AuthScreens.kt`
- Create: `apps/android/app/src/test/java/com/restaurantops/auth/SessionViewModelTest.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/MainActivity.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`

- [ ] **Step 1: Write failing session routing tests**

```kotlin
@Test fun restoredSingleStoreSessionEntersRemoteWorkspace() = runTest {
    val viewModel = SessionViewModel(FakeAuthRepository(stores = listOf(storeA)), FakeSelectedStoreStore())
    viewModel.restore()
    advanceUntilIdle()
    assertEquals(AppSessionState.RemoteWorkspace(storeA), viewModel.state)
}

@Test fun multipleStoresRequireSelectionUntilUserChoosesOne() = runTest { /* assert StoreSelection then RemoteWorkspace */ }
@Test fun logoutClearsTheSelectedStoreAndReturnsToLogin() = runTest { /* assert local stores are cleared */ }
@Test fun localDemoNeverCallsTheAuthRepository() = runTest { /* assert LocalDemo state */ }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.SessionViewModelTest`

Expected: compilation failure because SessionViewModel and AppSessionState do not exist.

- [ ] **Step 3: Implement session state and Compose screens**

```kotlin
sealed interface AppSessionState {
    data object Loading : AppSessionState
    data object Login : AppSessionState
    data class StoreSelection(val stores: List<StoreMembership>) : AppSessionState
    data class RemoteWorkspace(val store: StoreMembership) : AppSessionState
    data object LocalDemo : AppSessionState
}
```

`MainActivity` renders `LoginScreen`, `StoreSelectionScreen`, `WorkspaceRoot(storeId = ...)`, or the existing onboarding/local workspace according to this state. Debug local demo is an explicit action; release never exposes the action. The store picker restores only a persisted store that is still in the current server-returned membership list.

- [ ] **Step 4: Run the test to verify it passes**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest --tests com.restaurantops.auth.SessionViewModelTest`

Expected: PASS.

- [ ] **Step 5: Commit session routing and store selection**

```powershell
git add apps/android/app/src/main/java/com/restaurantops/auth apps/android/app/src/main/java/com/restaurantops/MainActivity.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/test/java/com/restaurantops/auth/SessionViewModelTest.kt
git commit -m "feat(android): select authorized workspace store"
```

### Task 5: Preserve Local Demo Isolation And Verify UI

**Files:**
- Modify: `apps/android/app/src/androidTest/java/com/restaurantops/MainActivityNavigationTest.kt`
- Create: `apps/android/app/src/androidTest/java/com/restaurantops/AuthFlowTest.kt`
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`

- [ ] **Step 1: Write failing UI contract tests**

```kotlin
@Test fun debugLoginScreenOffersExplicitLocalDemo() {
    composeRule.onNodeWithText("本地演示").assertIsDisplayed().performClick()
    composeRule.onNodeWithText("今日经营").assertIsDisplayed()
}

@Test fun storeSelectionUsesTheSelectedStoreForOperations() {
    // inject a two-store session, select store_b, open operations, assert store_b request path
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `gradlew.bat :apps:android:app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.restaurantops.AuthFlowTest`

Expected: FAIL because the login and store-selection UI is not yet exposed through MainActivity.

- [ ] **Step 3: Complete only the wiring required by the UI contracts**

Use the session-selected `storeId` in the imports, metric catalog, and operations repositories. Leave `LocalDemoImportRepository`, local onboarding content, and all offline UI paths un-authenticated. Do not add a release base URL, account seed, credential, default bearer token, or service-provider feedback UI.

- [ ] **Step 4: Run device and full Android verification**

Run: `gradlew.bat :apps:android:app:testDebugUnitTest :apps:android:app:assembleDebug :apps:android:app:assembleRelease --no-daemon --console=plain`

Expected: unit tests and both APK variants succeed.

Run: `gradlew.bat :apps:android:app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.restaurantops.MainActivityNavigationTest,com.restaurantops.AuthFlowTest`

Expected: emulator UI contracts pass.

- [ ] **Step 5: Commit and request review**

```powershell
git add apps/android/app/src
git commit -m "test(android): cover authenticated workspace flow"
git diff --check HEAD~5..HEAD
```

Expected: no whitespace errors; request a code review before push.

## Self-Review

- Store authorization remains server-derived: the app sends only a selected `storeId` in existing route paths and never sends enterprise ID, actor ID, role, or decoded token claims.
- Password input is ViewModel/UI state only; it is cleared after every login attempt and is never written to a repository cache, log, SavedStateHandle, or encrypted preferences.
- Refresh-token encryption is isolated behind `RefreshTokenStore`, so JVM tests use fakes and never require Android framework encryption stubs.
- The interceptor is the only bearer-token attachment point, preventing imports, catalog calls, and operations from drifting into different refresh behavior.
- Debug local demo and release configurations remain explicit and non-overlapping; provider feedback stays out of this plan.
