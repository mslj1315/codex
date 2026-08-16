# Production Cloud Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the restaurant content application to `app.msljkj.cn` over HTTPS with authenticated API, customer Android test configuration, and both isolated internal consoles, while leaving video storage/rendering disabled until its protected infrastructure exists.

**Architecture:** Run Fastify and PostgreSQL as private Docker Compose services on the server. The host Nginx terminates TLS and proxies only the API and the two static consoles that Fastify serves under `/provider/` and `/operator/`; PostgreSQL has no public port. Production secrets live only in a root-readable server-side environment file, model calls use the server-only Responses provider, and no third-party gateway credentials enter an APK or a browser bundle.

**Tech Stack:** Docker Compose v2, Node 24 Alpine multi-stage image, PostgreSQL 16, host Nginx and Certbot, Android Gradle BuildConfig field, Fastify, OpenAI Responses-compatible provider.

---

## Target File Structure

- Modify: `services/api/Dockerfile` - build the provider and operator static applications, then copy both into the API image.
- Create: `deploy/production/compose.yml` - production-only API/PostgreSQL topology with private network and no development modes.
- Create: `deploy/production/.env.example` - documented placeholder environment file; contains no usable secrets.
- Create: `deploy/production/nginx/app.msljkj.cn.conf` - HTTPS reverse proxy limited to `/`, `/provider/`, and `/operator/` without trusting forwarded client headers.
- Create: `deploy/production/scripts/deploy.sh` - root-operated, fail-fast release helper that validates required environment values, pulls the source revision, builds, runs migrations exactly through the API command, and performs health checks.
- Create: `docs/operations/production-cloud-deployment.md` - server preparation, secret creation, first-account/price-role provisioning, backup, rollback, retention and video-disabled operating procedure.
- Modify: `apps/android/app/build.gradle.kts` - define an explicitly named cloud test build type with a compile-time HTTPS API root and leave debug emulator behavior unchanged.
- Modify: `apps/android/app/src/test/...` - test that the cloud test endpoint is HTTPS and that release does not silently use the emulator endpoint.

## Task 1: Prove the API Image Can Serve Both Control Planes

**Files:**
- Modify: `services/api/Dockerfile`
- Test: `services/api/test/operator-console-static.test.ts`
- Test: `services/api/test/provider-console-static.test.ts`

- [ ] **Step 1: Write a failing image-layout/static-registration test**

Add a test that starts the built-server configuration with independent provider and operator distribution directories and proves `/provider/` returns only the provider fixture while `/operator/` returns only the operator fixture. Include a test assertion that `services/api/Dockerfile` contains both `provider-console-dist` and `operator-console-dist` copy destinations.

```ts
expect(dockerfile).toContain("/build/apps/operator-console/dist ./operator-console-dist");
expect(await app.inject({ method: "GET", url: "/operator/" })).toMatchObject({ statusCode: 200 });
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `cd services/api && npm test -- --run test/operator-console-static.test.ts test/provider-console-static.test.ts`

Expected: FAIL because the Dockerfile only builds/copies the provider console.

- [ ] **Step 3: Add the second build stage and runtime copy**

Add a separate `operator-console-build` stage using `apps/operator-console/package.json` and its lockfile. Copy both static build outputs into `/app/provider-console-dist` and `/app/operator-console-dist`. Keep the runtime stage limited to API runtime dependencies; do not copy source `.env` files or frontend source code.

```dockerfile
FROM node:24-alpine AS operator-console-build
WORKDIR /build/apps/operator-console
COPY apps/operator-console/package.json apps/operator-console/package-lock.json ./
RUN npm ci
COPY apps/operator-console/ ./
RUN npm run build
```

- [ ] **Step 4: Run focused API tests, both frontend builds, and API typecheck**

Run:

```powershell
cd services/api; npm test -- --run test/operator-console-static.test.ts test/provider-console-static.test.ts; npm run typecheck
cd ../../apps/provider-console; npm run build
cd ../operator-console; npm run build
```

Expected: all commands exit 0; no static route shares another console's assets.

- [ ] **Step 5: Commit**

```powershell
git add services/api/Dockerfile services/api/test
git commit -m "feat: package both control plane consoles"
```

## Task 2: Add a Production-Only Compose Topology and Host Nginx Contract

**Files:**
- Create: `deploy/production/compose.yml`
- Create: `deploy/production/.env.example`
- Create: `deploy/production/nginx/app.msljkj.cn.conf`
- Test: `services/api/test/production-deployment-static.test.ts`

- [ ] **Step 1: Write failing static configuration tests**

Add a static test that parses the Compose YAML as text and asserts: there is no `LOCAL_CONTAINER_DEVELOPMENT_MODE: "true"`; no PostgreSQL, MinIO, or API host `ports` are exposed except `127.0.0.1:3000:3000`; the API environment uses `AUTH_TOKEN_SECRET`, `DATABASE_URL`, and server-only model fields; `VIDEO_STORAGE_MODE=disabled`; and no concrete secret appears. Assert the Nginx configuration serves `app.msljkj.cn`, proxies to `127.0.0.1:3000`, and has TLS-only redirect behavior.

```ts
expect(compose).not.toContain('LOCAL_CONTAINER_DEVELOPMENT_MODE: "true"');
expect(compose).toContain('127.0.0.1:3000:3000');
expect(compose).toContain('VIDEO_STORAGE_MODE: disabled');
expect(nginx).toContain('server_name app.msljkj.cn');
```

- [ ] **Step 2: Run the static configuration test to verify RED**

Run: `cd services/api && npm test -- --run test/production-deployment-static.test.ts`

Expected: FAIL because production files do not exist.

- [ ] **Step 3: Create private service configuration**

Create `deploy/production/compose.yml` with:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env_file: .env
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
  api:
    build:
      context: ../..
      dockerfile: services/api/Dockerfile
    env_file: .env
    environment:
      PORT: "3000"
      DATABASE_URL: postgresql://$${POSTGRES_USER}:$${POSTGRES_PASSWORD}@postgres:5432/$${POSTGRES_DB}
      VIDEO_STORAGE_MODE: disabled
    ports: ["127.0.0.1:3000:3000"]
```

Keep `LOCAL_CONTAINER_DEVELOPMENT_MODE`, `DEVELOPMENT_MODE`, all MinIO endpoints and browser development mode absent/false. The `.env.example` must use obvious placeholders only, require a generated `AUTH_TOKEN_SECRET`, list the server-only Responses fields, and state that no copy of this file may be committed after it becomes `.env`.

Create Nginx configuration with port 80 redirect to HTTPS and port 443 certificate placeholders, `proxy_pass http://127.0.0.1:3000`, `proxy_set_header Host $host`, and tight body/time limits matching the current 5 MiB API JSON boundary. Do not proxy MinIO or PostgreSQL.

- [ ] **Step 4: Run static tests and Compose validation**

Run:

```powershell
cd services/api; npm test -- --run test/production-deployment-static.test.ts
cd ../../deploy/production; docker compose --env-file .env.example config
```

Expected: test passes and Compose prints a valid configuration without requiring an actual secret.

- [ ] **Step 5: Commit**

```powershell
git add deploy/production services/api/test/production-deployment-static.test.ts
git commit -m "feat: add production cloud deployment topology"
```

## Task 3: Add a Deliberate Android Cloud-Test Endpoint

**Files:**
- Modify: `apps/android/app/build.gradle.kts`
- Create or Modify: `apps/android/app/src/test/java/com/restaurantops/.../ApiEndpointConfigTest.kt`

- [ ] **Step 1: Write a failing BuildConfig endpoint test**

Create a JVM test or Gradle task assertion for a new `cloudTest` build type. It must assert the endpoint is exactly `https://app.msljkj.cn/`, not a cleartext address, loopback host, `10.0.2.2`, or URL containing credentials.

```kotlin
assertEquals("https://app.msljkj.cn/", cloudTestBaseUrl)
assertTrue(cloudTestBaseUrl.startsWith("https://"))
assertFalse(cloudTestBaseUrl.contains("@"))
```

- [ ] **Step 2: Run focused test to verify RED**

Run: `cd apps/android; $env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'; .\gradlew.bat :app:testCloudTestUnitTest --tests '*ApiEndpointConfigTest'`

Expected: FAIL because `cloudTest` does not exist.

- [ ] **Step 3: Implement the cloud test build type**

Add `cloudTest` initialized from `debug`, with `applicationIdSuffix = ".cloudtest"`, an explicit label suffix, and `BuildConfig.LOCAL_API_BASE_URL` set to `https://app.msljkj.cn/`. Preserve the existing debug emulator endpoint and leave release empty until a signed distribution policy exists.

- [ ] **Step 4: Run Android unit tests and build the cloud-test APK**

Run:

```powershell
cd apps/android
$env:ANDROID_HOME='C:\Users\50633\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT=$env:ANDROID_HOME
.\gradlew.bat :app:testCloudTestUnitTest :app:assembleCloudTest
```

Expected: BUILD SUCCESSFUL and the APK only embeds the HTTPS cloud endpoint.

- [ ] **Step 5: Commit**

```powershell
git add apps/android/app/build.gradle.kts apps/android/app/src/test
git commit -m "feat: add Android cloud test build"
```

## Task 4: Document and Validate the Server Release Procedure

**Files:**
- Create: `deploy/production/scripts/deploy.sh`
- Create: `docs/operations/production-cloud-deployment.md`
- Test: `services/api/test/production-deployment-static.test.ts`

- [ ] **Step 1: Write a failing release-script safety test**

Extend the static deployment test to require `set -eu`, root ownership/documented `chmod 600 .env`, strict required-variable checks, `docker compose ... up -d --build`, API health polling through `http://127.0.0.1:3000/health`, and no use of `curl | sh`, `--privileged`, or `docker system prune`.

```ts
expect(script).toContain("set -eu");
expect(script).toContain("/health");
expect(script).not.toContain("docker system prune");
```

- [ ] **Step 2: Run test to verify RED**

Run: `cd services/api && npm test -- --run test/production-deployment-static.test.ts`

Expected: FAIL because the release script and operations runbook do not exist.

- [ ] **Step 3: Implement release procedure and operational boundary**

The script must run from a checked-out repository, refuse missing `.env`, validate `AUTH_TOKEN_SECRET`, PostgreSQL values, and all four Responses provider values when `MODEL_PROVIDER=openai_responses`; invoke Compose with the production files; and poll local health for a bounded period. It must never print `.env` contents or the model key.

The runbook must include concrete server preparation: dedicated `/opt/restaurant-ops` checkout, firewall only 22/80/443, a root-readable `deploy/production/.env` created with `umask 077`, Nginx installation alongside the pre-existing unrelated `bot.msljkj.cn` site, Certbot certificate issuance only after DNS check, migration behavior, database volume backup/restore, account provisioning, `model_pricing_operator` grant, price draft/publish sequence, rollback to image/tag, and maintenance job scheduling. Explicitly state video remains disabled and no auto-publish to Douyin exists.

- [ ] **Step 4: Run final static/deployment checks**

Run:

```powershell
cd services/api; npm test -- --run test/production-deployment-static.test.ts; npm run typecheck
cd ../../deploy/production; docker compose --env-file .env.example config
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git add deploy/production docs/operations/production-cloud-deployment.md services/api/test/production-deployment-static.test.ts
git commit -m "docs: add guarded production release procedure"
```

## Task 5: Deploy Only After Server Credentials Are Locally Installed

**Files:**
- No repository edits required.
- Server-only: `/opt/restaurant-ops/deploy/production/.env`
- Server-only: `/etc/nginx/conf.d/app.msljkj.cn.conf`

- [ ] **Step 1: Validate DNS, available memory/disk, and existing Nginx sites before write operations**

Run from the administrator workstation:

```powershell
Resolve-DnsName app.msljkj.cn
ssh root@47.108.253.48 'free -h; df -h; nginx -T'
```

Expected: DNS resolves to `47.108.253.48`; no existing `app.msljkj.cn` configuration will be overwritten; sufficient space exists for image plus database volume.

- [ ] **Step 2: Generate production secrets on the server and create the non-versioned environment file**

Use `umask 077`, `openssl rand -hex 48` for `AUTH_TOKEN_SECRET`, distinct generated PostgreSQL password, and a newly rotated gateway model key. Do not paste any secret into chat, source control, Android configuration, Nginx, or either console.

- [ ] **Step 3: Stage Compose source, build and start private services**

Run `deploy.sh` from `/opt/restaurant-ops`, wait for `/health`, then inspect `docker compose ps` and only redacted logs. Confirm migrations through `029` applied.

- [ ] **Step 4: Install Nginx proxy and certificate without touching the unrelated bot site**

Run `nginx -t` before reload, obtain/renew only the `app.msljkj.cn` certificate, then verify `https://app.msljkj.cn/health`, `/provider/`, and `/operator/` return the expected application surfaces over TLS.

- [ ] **Step 5: Provision test accounts and validate the live boundary**

Use server-local environment variables with `provision:account` for a normal customer and `grant:service-role` only for a dedicated pricing operator. Verify a customer cannot call provider pricing endpoints and a provider-role account cannot enter content/media routes. Create a draft model price, publish it, make one customer generation request only after the gateway key is known-good, then check the customer aggregate shows no provider/model/content data.

- [ ] **Step 6: Build and install the cloud-test APK; test manually**

Install `app-cloudTest.apk` on emulator/device; sign in through HTTPS, create profile/content task, generate and review a three-version copy set, confirm it, and inspect cost summary. Do not enable storyboard upload/render until the separate object-storage/FFmpeg implementation has been deployed and reviewed.

- [ ] **Step 7: Record launch evidence without secrets and commit only source changes**

Capture command exit codes, HTTP status results, applied migration numbers, image digest, and manual test observations in a local operations log that contains no credentials. Do not commit server `.env`, certificate material, database dump, or model keys.

## Plan Review

**Spec coverage:** Task 1 fixes the missing operator static bundle; Task 2 replaces the unsafe development Compose configuration with a private production topology and TLS contract; Task 3 creates a testable Android HTTPS build; Task 4 supplies deterministic, guarded release operations; Task 5 gives the server deployment and manual acceptance sequence. Video remains intentionally disabled and model credentials stay server-only throughout.

**Placeholder scan:** This plan contains no implementation placeholders. Production values in `.env.example` are intentionally non-working placeholders, and Task 5 mandates their server-local replacement.

**Type consistency:** The plan uses the existing API static paths `/provider/` and `/operator/`, the existing `LOCAL_API_BASE_URL` BuildConfig field, the existing `MODEL_PROVIDER=openai_responses` and `VIDEO_STORAGE_MODE=disabled` environment contracts, and the current migrations through `029`.
