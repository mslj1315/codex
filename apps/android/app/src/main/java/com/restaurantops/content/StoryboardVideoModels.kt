package com.restaurantops.content

const val MAX_STORYBOARD_SOURCES = 20
const val MAX_STORYBOARD_SOURCE_BYTES = 500L * 1024L * 1024L
const val MAX_STORYBOARD_SOURCE_SECONDS = 10 * 60

data class GalleryVideo(val id: String, val displayName: String, val sizeBytes: Long, val durationSeconds: Int)
data class UploadValidation(val isAllowed: Boolean, val message: String? = null)
object StoryboardUploadPolicy {
    fun validate(videos: List<GalleryVideo>): UploadValidation = when {
        videos.size > MAX_STORYBOARD_SOURCES -> UploadValidation(false, "Select at most 20 source videos.")
        videos.any { it.sizeBytes > MAX_STORYBOARD_SOURCE_BYTES } -> UploadValidation(false, "Each source video must be 500 MB or smaller.")
        videos.sumOf { it.durationSeconds } > MAX_STORYBOARD_SOURCE_SECONDS -> UploadValidation(false, "Selected sources must total 10 minutes or less.")
        else -> UploadValidation(true)
    }
}

enum class UploadState { Selected, Uploading, Uploaded, Failed, ReadyToRetry }
data class UploadItem(val source: GalleryVideo, val state: UploadState = UploadState.Selected, val error: String? = null, val assetId: String? = null) {
    fun recover() = copy(state = UploadState.ReadyToRetry, error = null)
}

data class StoryboardSlot(
    val id: String, val order: Int, val kind: String = "shot", val assetId: String? = null,
    val trimStartSeconds: Int = 0, val trimEndSeconds: Int = 0, val muted: Boolean = false,
    val subtitleEnabled: Boolean = true, val subtitleText: String = ""
)
data class StoryboardDraft(val projectId: String, val version: Int, val slots: List<StoryboardSlot>, val coverAssetId: String? = null, val coverFrameOffsetSeconds: Int? = null, val coverTitle: String = "") {
    fun isRenderable() = slots.isNotEmpty() && slots.all { it.assetId != null && it.trimEndSeconds > it.trimStartSeconds }
}
enum class RenderState { Queued, Processing, Succeeded, Failed, Cancelled }
data class StoryboardRender(val id: String, val kind: String, val state: RenderState, val expiresAt: String? = null, val coverCandidates: List<String> = emptyList()) {
    val canCancel get() = state == RenderState.Queued || state == RenderState.Processing
}
enum class StoryboardCustomerActions { SelectSources, Upload, Edit, Preview, Render, Download, Delete }
fun renderExpiryMessage(kind: String) = if (kind == "preview") "Preview expires after 7 days." else "Final video expires after 180 days."
