# Android Action Execution Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let the Android Operations tab execute only the server-authorized action-card lifecycle transitions and record structured execution/verification results.

**Architecture:** Extend the existing Retrofit operations contract with the server's store-scoped status `PATCH`. Keep request and response mapping inside `HttpOperationsRepository`; `OperationsViewModel` replaces only the updated action card after a successful request and retains all prior UI state on failure. The Compose screen derives its controls from the card's server status, so no local transition authority exists.

**Tech Stack:** Kotlin, Retrofit 2, Gson, Jetpack Compose Material 3, Lifecycle ViewModel, Kotlin coroutines, JUnit 4.

---

## File Map

- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsApi.kt`: PATCH endpoint and public request DTO.
- `apps/android/app/src/main/java/com/restaurantops/operations/HttpOperationsRepository.kt`: action-card lifecycle types, mapping, repository mutation call.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsViewModel.kt`: per-card update state and replacement behavior.
- `apps/android/app/src/main/java/com/restaurantops/operations/OperationsScreen.kt`: status-led action controls and in-memory completion note.
- `apps/android/app/src/test/java/com/restaurantops/operations/HttpOperationsRepositoryTest.kt`: endpoint request and DTO mapping tests.
- `apps/android/app/src/test/java/com/restaurantops/operations/OperationsViewModelTest.kt`: success, error retention, and transition behavior tests.

### Task 1: Add the Public Status-Patch Contract

**Files:** Modify `OperationsApi.kt`; modify `HttpOperationsRepository.kt`; modify `HttpOperationsRepositoryTest.kt`.

- [ ] Write failing repository tests for a completion request and mapped outcome:

```kotlin
@Test
fun `completion sends only execution note and maps returned card`() = runBlocking {
    val api = RecordingOperationsApi()
    val updated = HttpOperationsRepository(api).updateActionCard(
        "store_demo", "action_1", ActionCardUpdate.completed("Checked menu placement")
    )

    assertEquals("completed", api.statusRequest!!.status)
    assertEquals("Checked menu placement", api.statusRequest!!.executionNote)
    assertNull(api.statusRequest!!.verificationOutcome)
    assertEquals(ActionCardStatus.COMPLETED, updated.status)
    assertEquals("Checked menu placement", updated.executionNote)
}
```

- [ ] Run `..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.operations.HttpOperationsRepositoryTest' '--no-daemon' '--console=plain'`.

Expected: compilation fails because `ActionCardUpdate`, status update API, and repository method do not exist.

- [ ] Add types and Retrofit endpoint:

```kotlin
enum class ActionCardStatus { PROPOSED, IN_PROGRESS, COMPLETED, VERIFIED, CANCELLED }
enum class ActionCardVerificationOutcome { EFFECTIVE, INEFFECTIVE, NOT_EXECUTED, DATA_INSUFFICIENT }

data class ActionCardUpdate(
    val status: ActionCardStatus,
    val executionNote: String? = null,
    val verificationOutcome: ActionCardVerificationOutcome? = null
) {
    companion object {
        fun start() = ActionCardUpdate(ActionCardStatus.IN_PROGRESS)
        fun cancel() = ActionCardUpdate(ActionCardStatus.CANCELLED)
        fun completed(note: String) = ActionCardUpdate(ActionCardStatus.COMPLETED, executionNote = note)
        fun verified(outcome: ActionCardVerificationOutcome) = ActionCardUpdate(ActionCardStatus.VERIFIED, verificationOutcome = outcome)
    }
}
```

Add `@PATCH("/v1/stores/{storeId}/action-cards/{actionCardId}/status")` accepting `ActionCardStatusRequest(status, executionNote, verificationOutcome)`. Add `updateActionCard` to `OperationsRepository`, have the HTTP repository call the endpoint through its existing typed request wrapper, and map status/outcome from explicit API wire values. Extend `ActionCard` with nullable `executionNote` and `verificationOutcome`; retain only public fields.

- [ ] Re-run the focused command. Expected: repository tests pass. Commit with `feat(android): add action card update contract`.

### Task 2: Apply Updates Atomically in the ViewModel

**Files:** Modify `OperationsViewModel.kt`; modify `OperationsViewModelTest.kt`.

- [ ] Write failing tests:

```kotlin
@Test
fun `successful update replaces only the matching card and clears its summary`() = runTest {
    val repository = FakeOperationsRepository(cards = listOf(proposedCard, otherCard))
    val viewModel = OperationsViewModel(repository, this)
    viewModel.load("store_demo", "2026-08-01", "2026-08-07")
    advanceUntilIdle()
    viewModel.loadVerificationSummary("store_demo", proposedCard.id)
    advanceUntilIdle()

    viewModel.updateActionCard("store_demo", proposedCard.id, ActionCardUpdate.start())
    advanceUntilIdle()

    assertEquals(ActionCardStatus.IN_PROGRESS, viewModel.actionCards.first().status)
    assertEquals(otherCard, viewModel.actionCards.last())
    assertNull(viewModel.verificationSummary)
}

@Test
fun `failed update retains cards summary and neutral error`() = runTest {
    val repository = FakeOperationsRepository(cards = listOf(proposedCard)).apply {
        updateFailure = OperationsRequestException(409, "private conflict")
    }
    val viewModel = OperationsViewModel(repository, this)
    viewModel.load("store_demo", "2026-08-01", "2026-08-07")
    advanceUntilIdle()

    viewModel.updateActionCard("store_demo", proposedCard.id, ActionCardUpdate.start())
    advanceUntilIdle()

    assertEquals(proposedCard, viewModel.actionCards.single())
    assertEquals("Unable to load operations data", viewModel.requestError)
}
```

- [ ] Run `..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.operations.OperationsViewModelTest' '--no-daemon' '--console=plain'`.

Expected: compilation fails because `updateActionCard` is absent.

- [ ] Add `updatingActionCardId` private-set state and:

```kotlin
fun updateActionCard(storeId: String, actionCardId: String, update: ActionCardUpdate) {
    if (updatingActionCardId != null || isLoading) return
    updatingActionCardId = actionCardId
    requestError = null
    operationScope.launch {
        try {
            val updated = repository.updateActionCard(storeId, actionCardId, update)
            actionCards = actionCards.map { card -> if (card.id == updated.id) updated else card }
            if (selectedActionCardId == updated.id) {
                selectedActionCardId = null
                verificationSummary = null
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: OperationsRequestException) {
            requestError = neutralMessage(error)
        } catch (_: Throwable) {
            requestError = FAILURE_MESSAGE
        } finally {
            updatingActionCardId = null
        }
    }
}
```

Do not set the whole-screen `isLoading` for a per-card update. Preserve draft UI inputs in Compose on failure. Re-run green and commit with `feat(android): update action card state`.

### Task 3: Render Status-Led Execution Controls

**Files:** Modify `OperationsScreen.kt`; modify `OperationsViewModelTest.kt` only if a state helper needs unit coverage.

- [ ] Add a pure internal status helper and failing tests covering all five statuses:

```kotlin
internal fun ActionCardStatus.nextCommands(): Set<ActionCardCommand> = when (this) {
    ActionCardStatus.PROPOSED -> setOf(ActionCardCommand.START, ActionCardCommand.CANCEL)
    ActionCardStatus.IN_PROGRESS -> setOf(ActionCardCommand.COMPLETE, ActionCardCommand.CANCEL)
    ActionCardStatus.COMPLETED -> setOf(ActionCardCommand.VERIFY)
    ActionCardStatus.VERIFIED, ActionCardStatus.CANCELLED -> emptySet()
}
```

- [ ] Run the Operations ViewModel focused command and verify test red before adding the helper.

- [ ] Update each action-card row to show only `nextCommands()`:

```kotlin
when (ActionCardCommand.COMPLETE) {
    in commands -> CompletionNoteEditor(
        note = note,
        onNoteChanged = { note = it },
        enabled = note.trim().isNotEmpty() && note.length <= 500 && !isUpdating,
        onComplete = { onUpdate(ActionCardUpdate.completed(note.trim())) }
    )
    else -> Unit
}
```

Start/cancel directly call `onUpdate`. Verified outcomes call
`ActionCardUpdate.verified(outcome)`. Display saved execution note and outcome
for completed/verified cards. Disable every command for the updating card only;
the other cards remain interactive. Do not render commands for terminal states,
do not log note text, and do not persist a draft outside the composable.

- [ ] Run full Android verification:

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
..\..\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' ':apps:android:app:assembleDebug' ':apps:android:app:assembleRelease' '--no-daemon' '--console=plain'
```

Expected: all tests and both APK variants pass. Commit with `feat(android): execute action cards`.

### Task 4: Final Verification and Delivery

**Files:** Modify only code necessary to correct a verified defect.

- [ ] Run `git diff --check`, `git status --short`, and the Task 3 full Android command after the final test change. Expected: all commands exit 0.

- [ ] Check scope with `rg -n "POS|ERP|delivery|platform|objectKey|batchId" apps/android/app/src/main/java/com/restaurantops/operations`; expect no external-system integration or infrastructure fields. Push with `git push origin feature/android-import-api`.
