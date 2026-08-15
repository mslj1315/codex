# Android Build Bootstrap Design

## Goal

Make the existing Android customer workspace independently buildable and testable from a fresh checkout without committing developer-specific SDK paths or changing product behavior.

## Scope

- Add the Android Gradle settings entry point with plugin-management repositories, dependency repositories, plugin versions, and the `:app` module inclusion.
- Add the standard Gradle wrapper pinned to the locally verified Gradle 8.11.1 distribution so CI and developer machines use the same launcher version.
- Use `ANDROID_HOME` or `ANDROID_SDK_ROOT` for this workstation's verification. A generated `local.properties` may be used locally because it is already ignored, but it must not be committed.
- Preserve the existing Android application ID, authentication flow, API contracts, manifest permissions, and product behavior.

## Non-Goals

- No Android feature work, dependency upgrades, SDK version changes, API changes, CI deployment, or release signing.
- No repository commit containing an absolute SDK path or local credentials.

## Verification

1. Establish RED by showing the current project cannot be resolved with Gradle because `settings.gradle.kts` is absent.
2. Add the minimal settings and wrapper configuration.
3. Run the Android unit-test task and Debug compilation with the installed Android 35 SDK.
4. Run the API regression suite and typecheck to confirm this build-only change does not affect server behavior.
5. Check Git status and diff for accidental local SDK files.
