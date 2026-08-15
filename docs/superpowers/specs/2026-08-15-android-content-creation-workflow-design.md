# Android Short-Video Content Creation Workflow Design

## Goal

Replace the Android client's local "AI video factory" placeholder with a customer-only, authenticated short-video content creation workflow. The workflow starts from customer inspiration, uses approved content planning APIs to generate topics and three materially different copy drafts, requires correction after any failed review, confirms one draft, and then hands the customer into the existing storyboard editing flow.

## Scope

This work covers the Android customer workspace and the additive API reads required to restore a customer's content planning work. It does not add Douyin OAuth, official data synchronization, a Douyin data connection page, POS integration, automatic publishing, provider/operator access to customer content, or real model/FFmpeg/signer integration tests.

The customer-facing label is "Short-video content creation". It does not claim that a video is automatically published to Douyin.

## Navigation

Add a dedicated Content Creation item to the authenticated customer workspace's bottom navigation. The content tab is a work queue:

- A primary action opens a compact new-task sheet.
- The remaining content lists only the current customer's non-terminal tasks, grouped by their current workflow state.
- Selecting a `topic_draft` task opens topic generation/selection; a task with topics but no copies opens its selected topic; a task with draft copies opens copy editing; a `copy_confirmed` task opens shot generation; and a task with a shot list opens the storyboard handoff.
- A task with a generated shot list presents an action that opens the existing storyboard context/editor flow.
- The local demo never presents generated sample output as remote AI work. It shows that real content creation requires an authenticated server connection.

The existing local placeholder video factory is removed as a route to fake topics, copy, reviews, storyboards, materials, or renders.

## New Task

The compact new-task sheet collects only customer-controlled inputs:

- Optional inspiration text, clearly marked as the primary creative direction.
- Persona.
- Content type.
- Style.
- Commercial level from 0 through 3.

The API continues to snapshot the current content profile, operating stage, and published templates. Android does not send profile/stage snapshots, tenant IDs, actor IDs, model identifiers, prompts, secrets, object addresses, or provider/operator roles.

## Workflow UI

The task detail is a stateful, linear workflow.

1. Create the task and request exactly three topics.
2. Let the customer select one topic and request exactly three copy drafts with distinct strategies.
3. Let the customer edit a draft title and body.
4. On confirmation, call the existing review-and-confirm endpoint.
5. When review blocks confirmation, retain the edited draft, show the returned actionable findings, and keep confirmation and shot generation unavailable. The customer must edit and resubmit the draft.
6. Once a copy is confirmed, allow shot-list generation.
7. Once the shot list exists, open the current lightweight storyboard editor for gallery upload, editing, render request, protected delivery, and deletion.

Android does not call a model directly. It never persists model credentials, raw prompts, or a separate copy of the customer's content outside normal Android UI state and authenticated API responses.

## API Additions

Add customer-only, store-scoped reads without changing existing generation or mutation contracts:

- `GET /v1/stores/:storeId/content-tasks` returns the authenticated customer's current tasks and public progression metadata.
- `GET /v1/stores/:storeId/content-tasks/:id` returns the authenticated customer's task details: task state, topics, copies, copy status/version, review-result summary needed for corrective editing, and any shot-list identifier/status.

Both routes resolve trusted customer context before parsing or reading task data. They return `403` for provider, operator editor, and operator reviewer callers. They do not return provider-facing aggregation data, model secrets, prompts, audit record internals, source object keys, media URLs, or customer content belonging to another customer.

Existing mutations remain authoritative: task creation, topic generation, copy generation, edit, review/confirm, and shot generation continue to enforce their current profile/stage, customer identity, generation-claim, immutable confirmation, and review gates.

## Android Components

Create a focused content-creation package with:

- API DTOs and Retrofit interface matching the additive reads and existing mutations.
- A repository that maps only typed customer workflow data and neutral errors.
- A ViewModel that owns task selection, new-task sheet state, generation progress, copy editing, review findings, and transition to a ready storyboard context.
- Compose screens for task list, new task, topic selection, three-draft copy editing, blocking review feedback, and ready-to-edit storyboard handoff.

Wire the new tab only through the existing authenticated API client. Keep the storyboard editor's existing API and protected-download behavior unchanged.

## Security And Privacy

All content creation routes and Android operations are customer-scoped. Provider and operator roles are denied at request entry and must not cause repository reads, writes, model calls, upload grants, storage actions, or render actions.

The provider console remains aggregate-feedback-only. Operator content administration remains independent and versioned; it does not receive a customer task, inspiration, draft, review finding, storyboard, media asset, or object address.

No endpoint automatically publishes to Douyin. Douyin official data connection and callback capability remain a separate second-phase project.

## Verification

Use test-first implementation.

- API tests cover list/detail ownership, provider/operator early denial, response redaction, and restoration of topic/copy/shot-list state.
- Android tests cover DTO mapping, customer workflow state transitions, review-blocked editing, tab navigation, and storyboard handoff.
- Run API tests and typecheck, Android unit tests and Debug APK build, then install and cold-start the APK on the existing emulator.

Real PostgreSQL, model-provider, FFmpeg, and signer-storage integrations are not prerequisites for this UI wiring. Their existing gated integration tests remain accurately marked when their dedicated environment variables or services are absent.
