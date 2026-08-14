# Storyboard Video Editing Design

## Goal

Add a customer-facing, storyboard-driven lightweight video editor that turns confirmed copy and confirmed shot lists into a rendered, downloadable Douyin-ready video. Customers publish manually; the system never automatically publishes to Douyin.

## Scope

- Android is the first-release source for selecting and uploading phone-gallery videos.
- A project is created only for a content task with confirmed copy and confirmed shot-list versions.
- Customers select clips for storyboard slots, trim in/out points, reorder slots, retain or mute original audio, edit per-shot subtitles, preview, render, choose a cover, download, and delete their own assets.
- The server renders preview/final MP4 output through an asynchronous FFmpeg worker.
- Final output is fixed at 1080x1920, H.264 MP4, 30fps, and at most 90 seconds.
- The system creates three real-video cover-frame candidates and accepts one customer-selected short title.
- The system does not add multi-track editing, filters, transitions, stickers, keyframes, colour grading, commercial music, AI-generated imagery, video auto-publishing, or Douyin password storage.

## Asset And Privacy Boundaries

Each project accepts at most 20 source video files, each at most 500MB, with a total source duration at most 10 minutes. Android validates limits before upload and the server validates them again after media inspection.

The API issues a short-lived, single-use object-storage upload grant bound to the authenticated enterprise, store, project, and asset. Android uploads directly to storage; API processes metadata only after upload completion. The API process does not proxy video bytes.

Raw source assets are available only to their owning customer and authorised render worker. They expire after 30 days by default and customers may delete them earlier. Final renders expire after 180 days by default and customers may delete them earlier. Deletion is audited; expired/deleted source assets cannot be restored or used for a new render. A final output can remain available after source deletion until its own expiry.

Providers and operator-console users cannot read raw assets, project timelines, subtitle drafts, unconfirmed renders, object URLs, or media credentials. They may later receive only confirmed aggregate outcome data under the existing provider-visibility boundary.

## Editing Model

The editor starts from ordered confirmed shot-list slots, not an empty professional timeline. A slot has its shooting purpose, suggested duration, script/subtitle text, and filming guidance. Customers may select/replace an uploaded source asset, set trim start/end, reorder slots, retain/mute original audio, toggle its subtitle, edit subtitle text, remove a slot, or add a supplemental slot.

Every timeline edit produces a new draft project version. A completed render is immutable; re-rendering after edits creates another output version rather than overwriting the previous output. The server enforces a 90-second total duration at save and render time.

## Subtitles And Covers

Subtitle drafts derive from confirmed copy and shot-list text, with one editable time-bounded subtitle per slot. No speech-recognition transcript is treated as authoritative. Only customer-saved subtitle text is burned into a render.

After successful rendering, FFmpeg extracts three frames at distinct meaningful positions. The customer selects one and may add a short title. Covers use actual video frames only; the system never generates fictional food, people, or locations.

## Render Pipeline

An API command creates either a preview or final render job. A queue permits at most one active job per project. The worker receives a narrowly authorised manifest, downloads required sources to temporary SSD space, performs trimming/ordering/audio/subtitle composition with FFmpeg, writes output and candidate covers to protected object storage, persists neutral job state, then cleans temporary files.

Retry only worker interruption, storage/transport failure, and explicitly retryable infrastructure failures. Invalid project state, missing assets, invalid media, quota breach, or FFmpeg validation failure are terminal customer-actionable failures. Clients see queued, processing, succeeded, failed, and cancelled states without storage credentials or raw worker errors.

Suggested minimum deployment separates an API service (2 vCPU/4GB) from an initial one-concurrent-render worker (4 vCPU/8GB plus 50-100GB SSD); storage is object storage and queue/lock state is separate. This is an operational starting point, not a product quota guarantee.

## Douyin Publication And Data Association

Customers download or preview the final output and publish manually in Douyin. The existing official-data design applies only after a customer starts publish association: official ID callback first, authorised recent-work selection second, verified pasted work link last. The system never infers a work from timestamp alone and does not call a Douyin publish API.

## Verification

Tests must cover task confirmation gates; signed upload scope/expiry/single use; asset count/size/duration limits; ownership and provider denial; timeline trim/order/audio/subtitle edits; version immutability; 90-second output validation; render queue uniqueness, cancellation, retry classification, temporary-file cleanup; output/cover retention/deletion; and no automatic publication.

Android tests must cover selection limits, upload state, project recovery, and customer-only access. API and UI checks must confirm neither object credentials nor raw assets are rendered in provider/operator paths. A real worker integration environment must validate FFmpeg output metadata, subtitle burn-in, and storage cleanup before release.
