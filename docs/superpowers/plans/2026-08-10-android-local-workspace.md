# Android Local Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Android 门店建档之后，实现可恢复的本地今日经营、诊断、任务和 AI 视频工厂演示流程。

**Architecture:** `WorkspaceViewModel` 使用 `SavedStateHandle` 保存标签页、任务和视频草稿。小型 Compose 页面只呈现固定的本地演示模型；`MainActivity` 负责从建档预览进入工作台。

**Tech Stack:** Kotlin、Jetpack Compose Material 3、AndroidX Lifecycle ViewModel/SavedStateHandle、JUnit 4、Gradle 8.11.1、Android SDK 35。

---

## Files

- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceModels.kt`：领域模型和固定演示数据。
- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceViewModel.kt`：本地状态转换与恢复。
- `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`：工作台与各业务页面。
- `apps/android/app/src/main/java/com/restaurantops/MainActivity.kt`：建档后路由。
- `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceModelsTest.kt`：模型单测。
- `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt`：状态单测。

### Task 1: Add Workspace Models

**Files:**
- Create: `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceModelsTest.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceModels.kt`

- [ ] **Step 1: Write a failing test**

```kotlin
@Test
fun `video factory stages keep the six approved steps in order`() {
    assertEquals(
        listOf("选题", "文案", "文字合规", "分镜", "素材", "视频库"),
        VideoFactoryStage.entries.map { it.title }
    )
}
```

- [ ] **Step 2: Verify red**

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.workspace.WorkspaceModelsTest' '--no-daemon'
```

Expected: FAIL because `VideoFactoryStage` is absent.

- [ ] **Step 3: Implement the minimal models**

```kotlin
enum class WorkspaceTab(val title: String) { HOME("首页"), TASKS("任务"), MESSAGES("消息"), PROFILE("我的") }
enum class VideoFactoryStage(val title: String) {
    TOPIC("选题"), COPY("文案"), COPY_COMPLIANCE("文字合规"),
    STORYBOARD("分镜"), ASSETS("素材"), LIBRARY("视频库")
}
data class LocalActionTask(val title: String, val owner: String, val dueDate: String, val metric: String, val status: String = "待开始")
```

- [ ] **Step 4: Verify green and commit**

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.workspace.WorkspaceModelsTest' '--no-daemon'
git add apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceModels.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceModelsTest.kt
git commit -m "feat(android): define local workspace models"
```

### Task 2: Persist Workspace State

**Files:**
- Create: `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceViewModel.kt`

- [ ] **Step 1: Write a failing restoration test**

```kotlin
@Test
fun `creating task and restoring view model retains task and selected tab`() {
    val handle = SavedStateHandle()
    val first = WorkspaceViewModel(handle)
    first.createPriorityTask()
    first.selectTab(WorkspaceTab.TASKS)
    val restored = WorkspaceViewModel(handle)
    assertEquals(WorkspaceTab.TASKS, restored.selectedTab)
    assertEquals("检查午市套餐曝光与核销承接", restored.tasks.single().title)
}
```

- [ ] **Step 2: Verify red**

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.workspace.WorkspaceViewModelTest' '--no-daemon'
```

Expected: FAIL because `WorkspaceViewModel` is absent.

- [ ] **Step 3: Implement the state boundary**

Create `WorkspaceViewModel(SavedStateHandle)` with `selectedTab`, `isDiagnosisOpen`, `isVideoFactoryOpen`, `tasks`, `videoStage`, `selectedTopic` and `copyDraft`. Persist all fields under stable `workspace_*` keys. `createPriorityTask()` must add no more than one priority task. Implement `selectTab`, `openDiagnosis`, `closeOverlay`, `openVideoFactory`, `advanceVideoStage`, `retreatVideoStage`, `selectTopic`, and `updateCopyDraft`.

- [ ] **Step 4: Add video-draft restoration test before its implementation**

```kotlin
@Test
fun `video draft restores selected topic copy and stage`() {
    val handle = SavedStateHandle()
    val first = WorkspaceViewModel(handle)
    first.openVideoFactory()
    first.selectTopic("午市双人套餐")
    first.updateCopyDraft("今天的双人套餐，适合午休快速开吃。")
    first.advanceVideoStage()
    val restored = WorkspaceViewModel(handle)
    assertEquals(VideoFactoryStage.COPY, restored.videoStage)
    assertEquals("午市双人套餐", restored.selectedTopic)
    assertEquals("今天的双人套餐，适合午休快速开吃。", restored.copyDraft)
}
```

- [ ] **Step 5: Verify green and commit**

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--tests' 'com.restaurantops.workspace.*' '--no-daemon'
git add apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceViewModel.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt
git commit -m "feat(android): persist local workspace state"
```

### Task 3: Build Today Workspace and Diagnosis

**Files:**
- Modify: `apps/android/app/src/main/java/com/restaurantops/MainActivity.kt`
- Create: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`
- Modify: `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt`

- [ ] **Step 1: Write failing task-content test**

```kotlin
@Test
fun `priority task has owner due date and metric`() {
    val viewModel = WorkspaceViewModel(SavedStateHandle())
    viewModel.createPriorityTask()
    val task = viewModel.tasks.single()
    assertEquals("店长", task.owner)
    assertEquals("明日午市前", task.dueDate)
    assertEquals("套餐核销率", task.metric)
}
```

- [ ] **Step 2: Verify red, then implement**

Run the Task 2 test command; then render `WorkspaceRoot` with 首页、任务、消息、我的四个标签。首页只显示本地演示的 `午市套餐核销下降 14%` 优先问题、数据边界、`查看诊断`、`创建行动任务`、待办数量和两大入口。

Implement a diagnosis overlay with this fixed order: 数据质量、诊断问题、行动建议、反思复盘、一句话方向。标明 `本地演示数据`，不显示 AI 分析成功。行动建议调用 `createPriorityTask()`；任务页显示任务标题、负责人、截止日、指标与状态。

- [ ] **Step 3: Verify green and commit**

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--no-daemon'
git add apps/android/app/src/main/java/com/restaurantops/MainActivity.kt apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt
git commit -m "feat(android): add today workspace and diagnosis"
```

### Task 4: Build Six-Stage Video Factory

**Files:**
- Modify: `apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt`
- Modify: `apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt`

- [ ] **Step 1: Write a failing boundary test**

```kotlin
@Test
fun `video stage cannot advance past local video library`() {
    val viewModel = WorkspaceViewModel(SavedStateHandle())
    repeat(VideoFactoryStage.entries.lastIndex + 2) { viewModel.advanceVideoStage() }
    assertEquals(VideoFactoryStage.LIBRARY, viewModel.videoStage)
}
```

- [ ] **Step 2: Verify red, then implement**

Run the Task 2 test command. Implement Previous/Next stage controls. Render three local topic sources in 选题; editable local copy in 文案; `本地规则演示，不构成平台审核结果` in 文字合规; shot guidance and upload placeholders in 分镜/素材; and `示例条目，未生成真实视频` in 视频库. Do not read files, invoke AI, state copy is compliant, or say video was generated.

- [ ] **Step 3: Verify green and commit**

```powershell
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' '--no-daemon'
git add apps/android/app/src/main/java/com/restaurantops/workspace/WorkspaceScreens.kt apps/android/app/src/test/java/com/restaurantops/workspace/WorkspaceViewModelTest.kt
git commit -m "feat(android): add local video factory flow"
```

### Task 5: Verify Milestone

**Files:**
- Modify only files from Tasks 1-4 when a verified issue is found.

- [ ] **Step 1: Run final checks**

```powershell
git diff --check
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-17.0.20.8-hotspot'
$env:ANDROID_HOME = 'C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
.\work\gradle-8.11.1\bin\gradle.bat ':apps:android:app:testDebugUnitTest' ':apps:android:app:assembleDebug' '--no-daemon'
```

Expected: BUILD SUCCESSFUL; APK at `apps/android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 2: Review and commit verified fixes**

Review state restoration, false success claims, video-stage boundaries and test coverage. Resolve verified issues, repeat Step 1, then commit the focused fixes.
