package com.restaurantops.content

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class StoryboardVideoState(val uploads: List<UploadItem> = emptyList(), val draft: StoryboardDraft? = null, val renders: List<StoryboardRender> = emptyList(), val error: String? = null)
class StoryboardVideoViewModel(private val repository: StoryboardVideoRepository) : ViewModel() {
    var state by mutableStateOf(StoryboardVideoState()); private set
    fun selectSources(sources: List<GalleryVideo>) { val check = StoryboardUploadPolicy.validate(sources); state = if (check.isAllowed) state.copy(uploads = sources.map(::UploadItem), error = null) else state.copy(error = check.message) }
    fun upload(storeId: String, taskId: String, shotListId: String, sourceId: String) = viewModelScope.launch { val item = state.uploads.firstOrNull { it.source.id == sourceId } ?: return@launch; state = state.copy(uploads = state.uploads.replace(sourceId, item.copy(state = UploadState.Uploading))); runCatching { repository.upload(storeId, taskId, shotListId, item.source) }.onSuccess { asset -> state = state.copy(uploads = state.uploads.replace(sourceId, item.copy(state = UploadState.Uploaded, assetId = asset.id))) }.onFailure { state = state.copy(uploads = state.uploads.replace(sourceId, item.copy(state = UploadState.Failed, error = "Upload failed. Retry when connected."))) } }
    fun recoverUpload(sourceId: String) { state = state.copy(uploads = state.uploads.map { if (it.source.id == sourceId) it.recover() else it }) }
    fun createProject(storeId: String, taskId: String, shotListId: String) = viewModelScope.launch { runCatching { repository.createProject(storeId, taskId, shotListId) }.onSuccess { state = state.copy(draft = it, error = null) }.onFailure { state = state.copy(error = "A confirmed storyboard is required before editing.") } }
    fun updateSlot(slot: StoryboardSlot) { state.draft?.let { draft -> state = state.copy(draft = draft.copy(slots = draft.slots.map { if (it.id == slot.id) slot else it }.sortedBy { it.order })) } }
    fun addSupplementalSlot() { state.draft?.let { draft -> state = state.copy(draft = draft.copy(slots = draft.slots + StoryboardSlot("supplemental-${draft.slots.size + 1}", draft.slots.size + 1, kind = "supplemental"))) } }
    fun updateCover(assetId: String?, frameOffsetSeconds: Int?, title: String) { state.draft?.let { state = state.copy(draft = it.copy(coverAssetId = assetId, coverFrameOffsetSeconds = frameOffsetSeconds, coverTitle = title.take(120))) } }
    fun requestRender(storeId: String, taskId: String, shotListId: String, kind: String) = viewModelScope.launch { val draft = state.draft ?: return@launch; runCatching { repository.saveProject(storeId, taskId, shotListId, draft); repository.createRender(storeId, taskId, shotListId, draft.projectId, kind) }.onSuccess { state = state.copy(renders = listOf(it) + state.renders) }.onFailure { state = state.copy(error = "Render could not be started.") } }
    fun refreshRenders(storeId: String, taskId: String, shotListId: String) = viewModelScope.launch { val projectId = state.draft?.projectId ?: return@launch; runCatching { repository.listRenders(storeId, taskId, shotListId, projectId) }.onSuccess { state = state.copy(renders = it) } }
}
private fun List<UploadItem>.replace(sourceId: String, replacement: UploadItem) = map { if (it.source.id == sourceId) replacement else it }
