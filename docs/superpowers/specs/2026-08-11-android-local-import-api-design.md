# Android Local Import API Design

## Goal

Connect the Android import-confirmation flow to the locally running import API for Android Emulator development. Keep the existing `ImportRepository` boundary so Compose screens and `ImportViewModel` do not know Retrofit, URLs, or transport DTOs.

## Scope

- Add Android internet permission.
- Add Retrofit and JSON serialization dependencies.
- Add a debug-only base URL of `http://10.0.2.2:3000/` for Android Emulator access to the API published from the host machine.
- Implement `HttpImportRepository` for manual import creation, import loading, candidate update, candidate confirmation, and latest facts retrieval.
- Convert `ImportRepository` operations and the corresponding `ImportViewModel` actions to suspend operations with explicit loading and error state.
- Route only manual import through the real API in this milestone.
- Preserve existing local CSV/XLSX placeholders. They do not read, upload, or synchronize files.

## Explicit Non-Goals

- No login, user session, token, API key, or production identity implementation.
- No production domain configuration and no deployment to `msljkj.cn`.
- No physical-device LAN access. The debug API remains bound to `127.0.0.1` on the host and is reached only through the Emulator alias `10.0.2.2`.
- No MinIO object upload, raw CSV/XLSX storage, or downloaded file access.
- No AI analysis, OCR, video generation, or background sync.

## Architecture

`ImportViewModel` continues to depend solely on `ImportRepository`. A new Retrofit service uses API request/response DTOs, and `HttpImportRepository` maps DTOs into the established domain models.

```text
Compose import screen
  -> ImportViewModel
  -> ImportRepository
  -> HttpImportRepository
  -> Retrofit API service
  -> http://10.0.2.2:3000
  -> Docker API / PostgreSQL
```

The app selects `HttpImportRepository` only for the emulator debug path. The existing `LocalDemoImportRepository` remains available as a local UI fallback until the runtime composition is switched deliberately in this milestone.

## API Contract

The Android client uses only the store-scoped API routes below with `store_demo` during local development:

- `POST /v1/stores/{storeId}/imports/manual`
- `GET /v1/stores/{storeId}/imports/{batchId}`
- `PATCH /v1/stores/{storeId}/imports/{batchId}/candidates/{candidateId}`
- `POST /v1/stores/{storeId}/imports/{batchId}/confirm`
- `GET /v1/stores/{storeId}/facts/latest`

The API supplies the trusted development enterprise, store, and actor identity. Android never submits or stores tenant, actor, credential, or API-key fields.

## State and Error Handling

`ImportViewModel` exposes a loading state and a user-facing request error state. The UI disables duplicate actions while a request is in progress.

- `422`: show the server validation message and retain the current import state.
- `403`: show that the local development store context rejected the request; do not retry automatically.
- `409`: reload the import batch before further user action because it may have been confirmed elsewhere.
- network, timeout, or malformed response: show a neutral connection-failure state and retain local form input where possible.

Successful confirmation uses the existing exact text `已生成确认数据版本`. Unresolved candidates continue to show `待确认，尚未用于诊断` and are never sent by the bulk-confirm action.

## Testing and Verification

- Unit-test DTO/domain mapping and repository request construction with a fake Retrofit service.
- Unit-test that ViewModel confirmation sends only `READY` candidate IDs and maps API failures to error state.
- Run all Android unit tests and build the debug APK.
- With Docker services running, execute the manual-import, candidate-confirmation, and latest-fact path from an Android Emulator using `10.0.2.2`.
- Verify the API remains published at `127.0.0.1:3000`, not a LAN address.
