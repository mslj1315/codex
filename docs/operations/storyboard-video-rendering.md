# Storyboard Video Rendering

Run rendering in a separate worker process. Configure `VIDEO_STORAGE_MODE=internal_signer`, `VIDEO_STORAGE_SIGNER_URL`, and `VIDEO_STORAGE_SIGNER_TOKEN`; the token is worker/server-only and must not be present in customer, provider, or operator applications. The storage signer must support `worker-download`, `worker-put-protected`, and `worker-delete-protected` with bucket policy that denies public reads.

Install an FFmpeg binary for the worker adapter. The adapter must use argument arrays rather than a shell and must produce H.264 MP4 output at 1080x1920, 30fps, and no more than 90 seconds. It may burn in only subtitle strings in the final confirmed project manifest. It must return exactly three actual output frames at distinct positions. Worker temporary directories must be isolated per job and removed on success, failure, and cancellation.

Before deployment, run a fixture through the real adapter and use `ffprobe` to check `codec_name=h264`, `width=1080`, `height=1920`, `r_frame_rate=30/1`, and duration at most 90 seconds. Inspect the output frames to verify subtitle burn-in, three distinct cover positions, and that the temporary directory no longer exists.

Final output and frames retain for 180 days; preview output retains for 7 days. Protected deletion failures stay pending for worker retry and never reveal object identifiers in an API response. Rendering never invokes Douyin OAuth, uploads media to Douyin, or publishes: the customer publishes manually.

## Android Customer Flow

The Android editor accepts gallery videos through the system document picker. It checks a maximum of 20 sources, 500 MB per source, and 10 minutes total duration before requesting a short-lived upload grant. The app uploads direct to the grant destination, then calls the completion endpoint; if direct upload fails, the selected source remains in a recoverable retry state. The API remains the authority for the same limits, ownership, expiry, and media inspection checks.

Only an authenticated customer that owns the content task can create assets, open projects, request preview/final renders, or see render status. Android presents neutral queued, processing, succeeded, failed, and cancelled states. Preview availability is seven days; final-video availability is 180 days. The app must request protected customer download access only after a succeeded response and must explain expiry rather than showing an object URL, storage credential, or raw storage key.

Customers work from confirmed storyboard slots: select an uploaded asset, set trim start/end, adjust order, mute original audio, enable or edit the per-slot subtitle, and add a supplemental slot. A final render returns real frame candidates, from which the customer chooses a cover and short title. Provider and operator applications must not add media/project/render routes, media credentials, object URLs, or a customer timeline display. There is no publish button or background publication action: after download, the customer publishes manually in Douyin.
