# Android Build Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/android` a reproducible Gradle project that can run its unit tests and compile a Debug APK with the installed Android SDK.

**Architecture:** `apps/android` becomes an independent Gradle root. Its settings file centrally resolves the existing Android and Kotlin plugins and includes the existing `app` module. The standard Gradle wrapper pins launcher behavior; SDK location remains local environment state and outside Git.

**Tech Stack:** Gradle 8.11.1, Android Gradle Plugin 8.7.3, Kotlin/Compose plugin 2.0.21, Android SDK platform 35.

---

### Task 1: Prove and Correct Root Project Resolution

**Files:**
- Create: `apps/android/settings.gradle.kts`
- Modify: `apps/android/build.gradle.kts`
- Test: Gradle `:app:tasks --all` command from `apps/android`

- [ ] **Step 1: Establish the current resolution failure**

Run from `apps/android` with the cached launcher and `ANDROID_HOME` set to `C:\\Users\\50633\\AppData\\Local\\Android\\Sdk`:

```powershell
& 'C:\\Users\\50633\\.gradle\\wrapper\\dists\\gradle-8.11.1-bin\\bpt9gzteqjrbo1mjrsomdt32c\\gradle-8.11.1\\bin\\gradle.bat' :app:tasks --all
```

Expected: Gradle cannot resolve the root project plugins because the directory has no settings file or plugin version declarations.

- [ ] **Step 2: Add minimal independent root settings**

Create `apps/android/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "restaurant-operations-android"
include(":app")
```

Replace `apps/android/build.gradle.kts` with:

```kotlin
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
```

- [ ] **Step 3: Verify root resolution**

Run the command from Step 1 again. Expected: exit code `0` and a task list containing `:app:testDebugUnitTest`.

- [ ] **Step 4: Commit root configuration**

```powershell
git add apps/android/settings.gradle.kts apps/android/build.gradle.kts
git commit -m "build: configure Android Gradle root"
```

### Task 2: Add the Pinned Gradle Wrapper and Verify Android

**Files:**
- Create: `apps/android/gradlew`
- Create: `apps/android/gradlew.bat`
- Create: `apps/android/gradle/wrapper/gradle-wrapper.jar`
- Create: `apps/android/gradle/wrapper/gradle-wrapper.properties`
- Test: `apps/android/gradlew.bat :app:testDebugUnitTest` and `apps/android/gradlew.bat :app:assembleDebug`

- [ ] **Step 1: Establish missing-wrapper failure**

Run from `apps/android`:

```powershell
& .\\gradlew.bat :app:testDebugUnitTest
```

Expected: PowerShell reports that `gradlew.bat` does not exist.

- [ ] **Step 2: Add the standard Gradle 8.11.1 wrapper**

Use the existing verified Gradle distribution to generate wrapper files:

```powershell
& 'C:\\Users\\50633\\.gradle\\wrapper\\dists\\gradle-8.11.1-bin\\bpt9gzteqjrbo1mjrsomdt32c\\gradle-8.11.1\\bin\\gradle.bat' wrapper --gradle-version 8.11.1
```

Verify `gradle-wrapper.properties` contains:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.11.1-bin.zip
```

- [ ] **Step 3: Run Android unit tests through the wrapper**

Run with the local SDK supplied only to the process:

```powershell
$env:ANDROID_HOME = 'C:\\Users\\50633\\AppData\\Local\\Android\\Sdk'
& .\\gradlew.bat :app:testDebugUnitTest
```

Expected: exit code `0` and JUnit test results under `app/build/test-results/testDebugUnitTest`.

- [ ] **Step 4: Compile the Debug APK through the wrapper**

```powershell
$env:ANDROID_HOME = 'C:\\Users\\50633\\AppData\\Local\\Android\\Sdk'
& .\\gradlew.bat :app:assembleDebug
```

Expected: exit code `0` and `app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 5: Commit wrapper and build metadata**

```powershell
git add apps/android/gradlew apps/android/gradlew.bat apps/android/gradle/wrapper
git commit -m "build: add Android Gradle wrapper"
```

### Task 3: Verify Boundaries and Regression Coverage

**Files:**
- Verify only: `apps/android/local.properties` remains untracked and ignored if created by a developer
- Verify only: `services/api`

- [ ] **Step 1: Run API regression suite**

```powershell
npm test
```

Run from `services/api`. Expected: all non-environment-gated API tests pass.

- [ ] **Step 2: Run API typecheck**

```powershell
npm run typecheck
```

Run from `services/api`. Expected: exit code `0`.

- [ ] **Step 3: Check local-path and diff boundaries**

```powershell
git status --short
git diff --check
git show --check HEAD
```

Expected: no tracked `local.properties`, no Android SDK path in tracked diff, and no whitespace errors.

- [ ] **Step 4: Commit any test-only metadata only if it was intentionally added**

No commit is expected for this verification task. Do not add `local.properties`, `.gradle`, or `app/build` artifacts.

