# Storyboard Video Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer turn confirmed content copy and shot lists into a lightweight, storyboard-driven, server-rendered, downloadable video without automatic Douyin publishing.

**Architecture:** First complete the scoped content-task/topic/copy/review/shot-list API foundation. Add media assets and editable project versions as customer-owned resources; object storage uses scoped short-lived upload grants and a queue worker renders FFmpeg manifests. Final renders can later be manually associated with official Douyin works, but the editor never calls a publish API.

**Tech Stack:** TypeScript, Fastify, PostgreSQL, object storage, FFmpeg worker, queue/Redis, Vitest, Kotlin/Compose Android upload/editor screens.

---

### Task 1: Complete Content Task, Copy, Review, And Confirmed Shot-List Foundation

**Files:**
- Complete/untracked: `services/api/migrations/018_content_planning_workflow.sql`, `services/api/src/content-planning/workflow-routes.ts`, `services/api/test/content-planning-workflow.test.ts`
- Modify: `services/api/src/server.ts`
- Create: `services/api/src/content-planning/task-repository.ts`, `generation-service.ts`, `review-service.ts`

- [ ] Write failing tests for scoped task creation, three distinct topics, three different-strategy copies, draft edits, deterministic/semantic blocking review, confirmation lock, and shot-list generation only after confirmed copy.
- [ ] Run `npm test -- --run test/content-planning-workflow.test.ts` and confirm red failures before retaining or completing any paused files.
- [ ] Implement immutable task input/profile/stage/template/rule/model snapshots and versioned topic/copy/shot-list records. Register routes only when a configured generation service exists; preserve existing Android/import contracts.
- [ ] Verify focused/full API tests, typecheck, and diff check; commit `feat: add content planning workflow`.

### Task 2: Persist Media Assets And Scoped Direct Upload Grants

**Files:**
- Create: `services/api/migrations/019_storyboard_media_assets.sql`, `services/api/src/video-editing/asset-repository.ts`, `storage.ts`, `services/api/test/video-assets.test.ts`
- Modify: content task routes/server configuration/.env example

- [ ] Write failing tests for confirmed-shot-list gate, 20 assets, 500MB per asset, 10 minute total, one-use expiring grant, enterprise/store/project ownership, and provider/operator denial.
- [ ] Implement protected asset metadata and direct-upload grant service; verify storage object metadata before accepting an asset. Store source expiry at 30 days and asset deletion audit; never expose storage credentials or raw asset URLs in provider routes.
- [ ] Run focused/full API tests and commit `feat: add storyboard media assets`.

### Task 3: Versioned Storyboard Editing And Subtitle/Cover State

**Files:**
- Create: `services/api/migrations/020_storyboard_projects.sql`, `services/api/src/video-editing/project-repository.ts`, `services/api/src/video-editing/routes.ts`, `services/api/test/storyboard-projects.test.ts`

- [ ] Write failing tests for project creation from a confirmed shot list, per-slot asset selection, trim validation, ordering, audio mute, subtitle edit, supplemental slots, 90-second cap, ownership, and immutable final versions.
- [ ] Implement customer-only versioned project drafts. Generate subtitle drafts from confirmed copy/shot text; accept only customer-saved text for render. Add cover selection/title state but do not generate AI imagery.
- [ ] Verify focused/full API tests and commit `feat: add storyboard editing projects`.

### Task 4: Queue-Based FFmpeg Preview And Final Render Pipeline

**Files:**
- Create: `services/api/src/video-editing/render-repository.ts`, `render-service.ts`, `worker.ts`, `services/api/test/storyboard-render.test.ts`
- Modify: project routes, storage abstraction, deployment configuration

- [ ] Write failing tests for one active render/project, queued/processing/succeeded/failed/cancelled states, retryable versus terminal errors, manifest-only worker access, 1080x1920 H.264 30fps/90-second constraints, and cleanup requests.
- [ ] Implement preview/final jobs, server-side FFmpeg manifest generation, scoped worker reads, protected output writes, three real-frame cover candidates, temporary-file cleanup, and 180-day final-render expiry. Never publish to Douyin.
- [ ] Verify unit tests plus a real worker integration environment that inspects output metadata and subtitle burn-in; commit `feat: render storyboard videos`.

### Task 5: Android Customer Editing Flow And Cross-Boundary Verification

**Files:**
- Create: Android media picker/upload/editor/view-model files under `apps/android/app/src/main/java/com/restaurantops/content/`
- Modify: customer content navigation, API models, operations documentation
- Create: `docs/operations/storyboard-video-rendering.md`

- [ ] Write Android tests for limits, upload recovery, customer-only visibility, trim/subtitle draft persistence, render state, preview/download, expiry messaging, and no publish control.
- [ ] Implement Android gallery selection, direct upload, storyboard slots, subtitle edit, preview/final render status, cover selection, and download. Do not expose raw media to provider-console.
- [ ] Run API/console/Android verification, real FFmpeg worker checks, privacy searches, and document queue sizing, object retention, cleanup, and manual-publish boundary; commit `feat: add Android storyboard video editing`.

## Self-Review

- Tasks 1-5 cover confirmed-content gating, direct upload, quotas, customer ownership, project versioning, subtitles, real covers, asynchronous FFmpeg rendering, retention, download, and no-auto-publish.
- No task adds commercial music, AI imagery, filters, multi-track editing, customer raw-media visibility for providers, or automatic Douyin publishing.
- Existing interrupted workflow files are explicitly red-tested before adoption rather than committed blindly.
