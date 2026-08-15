# Android Short-Video Content Creation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Android local video-factory placeholder with a customer-only authenticated content creation tab that restores and advances real content tasks through topics, three copy drafts, review/confirmation, shot generation, and storyboard editing.

**Architecture:** Add two additive customer-scoped API read routes beside existing workflow mutations. Android gets typed content-creation wire models, repository, ViewModel, and Compose screen, then the workspace gets a dedicated Content tab wired only through the authenticated Retrofit client. The current storyboard editor remains the sole upload, rendering, and protected-delivery surface.

**Tech Stack:** Fastify 5, TypeScript, PostgreSQL/pg-mem, Vitest, Kotlin, Compose, Retrofit, Gson, Android ViewModel, JUnit, MockWebServer.

---

## File Structure

- Modify `services/api/src/content-planning/workflow-routes.ts`: list/detail reads and explicit response mappers, including `topicId` on each copy.
- Create `services/api/migrations/025_content_task_customer_queue_index.sql`: index the customer work queue by enterprise, store, actor, and newest creation time.
- Modify `services/api/test/content-planning-workflow.test.ts`: ownership, role-denial, and response-redaction regressions.
- Create `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationModels.kt`: immutable task, topic, copy, finding, shot-list, and input types.
- Create `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationApi.kt`: Retrofit interface and response DTO mapping.
- Create `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationRepository.kt`: typed remote boundary and neutral exceptions.
- Create `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationViewModel.kt`: workflow and handoff state.
- Create `apps/android/app/src/main/java/com/restaurantops/content/ContentCreationScreen.kt`: task list, quick-start sheet, topic, copy, review, and handoff UI.
- Create `apps/android/app/src/test/java/com/restaurantops/content/ContentCreationScreenTest.kt`: Compose structure coverage for the task queue, blocking-review state, and handoff action.
- Modify `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceModels.kt`, `WorkspaceViewModel.kt`, and `WorkspaceScreens.kt`: Content tab and removal of local-generation placeholder path.
- Modify `apps/android/app/src/main/java/com/restaurantops/MainActivity.kt`: local demo remote-required state.
- Create `apps/android/app/src/test/java/com/restaurantops/content/ContentCreationApiTest.kt` and `ContentCreationViewModelTest.kt`.
- Modify `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceModelsTest.kt` and `WorkspaceViewModelTest.kt`.

### Task 1: Customer-Scoped Content Task Reads

**Files:** `services/api/src/content-planning/workflow-routes.ts`, `services/api/migrations/025_content_task_customer_queue_index.sql`, `services/api/test/content-planning-workflow.test.ts`, `services/api/test/migrate.test.ts`

- [ ] **Step 1: Write failing route tests.** Create a customer task using the existing workflow fixture, generate topics/copies, then assert:

```ts
const list = await app.inject({ method: "GET", url: "/v1/stores/store-a/content-tasks", headers: customerHeaders });
expect(list.statusCode).toBe(200);
expect(list.json().tasks).toEqual([expect.objectContaining({ id: taskId, status: "topic_draft" })]);
const detail = await app.inject({ method: "GET", url: `/v1/stores/store-a/content-tasks/${taskId}`, headers: customerHeaders });
expect(detail.json()).toEqual(expect.objectContaining({ id: taskId, topics: expect.any(Array), copies: expect.any(Array), shotList: null }));
expect(JSON.stringify(detail.json())).not.toMatch(/prompt|token|objectKey|url/i);
```

For each of `provider`, `operator_editor`, and `operator_reviewer`, call both endpoints with a malformed ID/body and assert `403` with no query/model-call counter increment. For another customer in the same enterprise/store, assert an empty list and `404` for the first customer's detail.

- [ ] **Step 2: Run RED.** `Set-Location services/api; npm test -- --run test/content-planning-workflow.test.ts` must fail because neither `GET` route exists.

- [ ] **Step 3: Implement the minimal reads.** Call `scoped(request)` before parameters or database access. List with `enterprise_id`, `store_id`, and `actor_id`, ordered by `created_at DESC`; add a migration creating `content_tasks_customer_queue_idx(enterprise_id, store_id, actor_id, created_at DESC)`. Detail queries the same three scope columns and returns `404` when absent, then maps ordered topics/copies with each copy's `topicId`, corrective review findings for the draft version, and a shot list only for the confirmed copy. With topics and no copies, the client reopens topic selection; with copies, it uses the returned `topicId` relationship. Do not serialize task snapshots, templates, generation audit runs, prompts, usage, model metadata, object identifiers, or media references.

- [ ] **Step 4: Run GREEN.** Re-run the focused command; all customer restore, redaction, and early-denial tests pass.

- [ ] **Step 5: Commit.** `git add services/api/src/content-planning/workflow-routes.ts services/api/test/content-planning-workflow.test.ts; git commit -m "feat: expose customer content task state"`.

### Task 2: Typed Android Content API Boundary

**Files:** `ContentCreationModels.kt`, `ContentCreationApi.kt`, `ContentCreationRepository.kt`, `ContentCreationApiTest.kt`

- [ ] **Step 1: Write failing MockWebServer tests.** Verify these authenticated Retrofit paths: list `GET /v1/stores/store-a/content-tasks`; detail `GET /v1/stores/store-a/content-tasks/task-1`; task create; topics generate; copies generate; copy `PUT`; copy confirm; shots generate. Feed a detail response with one topic, three drafts with distinct strategies, a blocking finding, and a shot list. Assert typed output contains none of `objectKey`, `url`, `prompt`, `token`, or provider fields. Assert non-2xx maps to a neutral `ContentCreationException`; only confirmation may carry blocking findings.

- [ ] **Step 2: Run RED.** `.\gradlew.bat :app:testDebugUnitTest --tests com.restaurantops.content.ContentCreationApiTest` must fail because no typed client exists.

- [ ] **Step 3: Implement the boundary.** Define `ContentTaskSummary`, `ContentTopic`, `ContentCopy`, `ContentReviewFinding`, `ContentShotList`, `ContentTaskDetail`, and `ContentTaskInput`. Use Retrofit `@Path` methods and typed request DTOs. Repository validates required IDs and exactly three materially different `strategy` values, maps DTOs, and produces neutral errors. Obtain Retrofit only through `AuthenticatedApiClient.retrofit(...)`.

- [ ] **Step 4: Run GREEN.** Re-run the focused test; request paths, mapping, malformed responses, and neutral errors pass.

- [ ] **Step 5: Commit.** `git add apps/android/app/src/main/java/com/restaurantops/content/ContentCreationModels.kt apps/android/app/src/main/java/com/restaurantops/content/ContentCreationApi.kt apps/android/app/src/main/java/com/restaurantops/content/ContentCreationRepository.kt apps/android/app/src/test/java/com/restaurantops/content/ContentCreationApiTest.kt; git commit -m "feat: add Android content creation API client"`.

### Task 3: Content Creation ViewModel State

**Files:** `ContentCreationViewModel.kt`, `ContentCreationViewModelTest.kt`

- [ ] **Step 1: Write failing state-transition tests.** With a fake repository: open the sheet, enter `ContentTaskInput("weekend set meal", "nearby_office", "spoken_video", "direct", 1)`, create/generate topics, select one, and assert three distinct drafts after copy generation. Return blocking review findings from confirmation; assert the editable copy is retained, findings are visible, `canGenerateShots` is false, and no handoff exists. Edit the same copy, return confirmation success, generate shots, and assert `ContentStoryboardHandoff(taskId, shotListId)`.

- [ ] **Step 2: Run RED.** `.\gradlew.bat :app:testDebugUnitTest --tests com.restaurantops.content.ContentCreationViewModelTest` must fail because the ViewModel is absent.

- [ ] **Step 3: Implement one immutable state owner.** `ContentCreationState` holds loading, tasks, selected detail, sheet/input, findings, `storyboardHandoff`, neutral error, and progress. Implement `load`, `selectTask`, `createAndGenerateTopics`, `generateCopies`, `updateCopy`, `confirmCopy`, and `generateShots` in `viewModelScope`. A failed confirmation only preserves editable state and findings; only a returned shot-list ID may populate the handoff.

- [ ] **Step 4: Run GREEN.** Re-run the focused test; restore, edit-after-block, confirmation, and handoff checks pass.

- [ ] **Step 5: Commit.** `git add apps/android/app/src/main/java/com/restaurantops/content/ContentCreationViewModel.kt apps/android/app/src/test/java/com/restaurantops/content/ContentCreationViewModelTest.kt; git commit -m "feat: add Android content creation workflow state"`.

### Task 4: Content Tab, Local-Demo Boundary, And Storyboard Handoff

**Files:** `ContentCreationScreen.kt`, `ContentCreationScreenTest.kt`, `WorkspaceModels.kt`, `WorkspaceViewModel.kt`, `WorkspaceScreens.kt`, `MainActivity.kt`, `WorkspaceModelsTest.kt`, `WorkspaceViewModelTest.kt`

- [ ] **Step 1: Write failing tab and screen tests.** Require `WorkspaceTab.fromWireValue("content") == WorkspaceTab.CONTENT`, select it in `WorkspaceViewModel`, and assert it persists. In a Compose structure test, assert `新建创作`, task-state headings, three strategy labels, editable title/body, blocking-review findings, and a storyboard action only when a shot-list handoff exists. Assert authenticated content UI contains no `本地占位`, `示例条目`, or `未生成真实视频`.

- [ ] **Step 2: Run RED.** `.\gradlew.bat :app:testDebugUnitTest --tests com.restaurantops.workspace.WorkspaceModelsTest --tests com.restaurantops.workspace.WorkspaceViewModelTest` must fail because `CONTENT` and its UI do not exist.

- [ ] **Step 3: Implement minimal UI wiring.** Add `CONTENT("内容创作", "content")`; remove `VideoFactoryStage`, `VideoFactoryLocalContent`, `isVideoFactoryOpen`, `openVideoFactory`, and `VIDEO_FACTORY`. In `WorkspaceRoot`, create the repository/ViewModel only if `authenticatedApiClient` is present. Render `ContentCreationScreen` for a remote session; otherwise render a `RemoteContentCreationRequiredScreen` composable in `ContentCreationScreen.kt` whose only user-facing action is return to login. The real screen opens the quick-start sheet, lists task states, and sends a handoff's exact task/shot-list IDs to the existing storyboard editor. It must not create a project, upload, render, download, or publish directly.

- [ ] **Step 4: Run GREEN.** `.\gradlew.bat :app:testDebugUnitTest --tests com.restaurantops.workspace.WorkspaceModelsTest --tests com.restaurantops.workspace.WorkspaceViewModelTest --tests com.restaurantops.content.ContentCreationViewModelTest` passes, including no-placeholder and handoff checks.

- [ ] **Step 5: Commit.** `git add apps/android/app/src/main/java/com/restaurantops/content/ContentCreationScreen.kt apps/android/app/src/test/java/com/restaurantops/content/ContentCreationScreenTest.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceModels.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceViewModel.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/main/java/com/restaurantops/MainActivity.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceModelsTest.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt; git commit -m "feat: wire Android content creation workspace"`.

### Task 5: Full Verification And Boundary Review

**Files:** Modify only files from Tasks 1-4 when fresh verification exposes a scoped defect.

- [ ] **Step 1: Verify API.** Run `Set-Location services/api; npm test; npm run typecheck`. All non-gated tests must pass; report real PostgreSQL, FFmpeg, and signer-storage gates as skipped only when their environment is absent.

- [ ] **Step 2: Verify Android and create Debug test APK.** Set SDK paths only in the command process, then run `.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug --rerun-tasks`. Run `apksigner verify --verbose app/build/outputs/apk/debug/app-debug.apk`, install it on `emulator-5554`, and cold-start `com.restaurantops/.MainActivity` only after build success.

- [ ] **Step 3: Review privacy boundaries.** Run `rg -n 'objectKey|url|prompt|token|provider|operator_editor|operator_reviewer|publish' services/api/src/content-planning apps/android/app/src/main/java/com/restaurantops/content` and `git diff --check`. Confirm no provider/operator customer content surface, Douyin connection route, or automatic publish action was introduced.

- [ ] **Step 4: Commit only scoped verification fixes, then request specification and quality review.** If no fix is needed, do not create a verification-only commit. Do not declare completion before both reviews and fresh verification evidence.
