package com.restaurantops.content

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.CancellationException

enum class ContentCreationStage {
    Idle,
    TopicSelection,
    CopyEditing,
    RevisionRequired,
    Confirmed,
    StoryboardReady
}

data class ContentCreationState(
    val tasks: List<ContentTaskSummary> = emptyList(),
    val usageSummary: CustomerUsageSummary? = null,
    val task: ContentTaskDetail? = null,
    val selectedTopicId: String? = null,
    val selectedCopyId: String? = null,
    val reviewFindings: List<ContentReviewFinding> = emptyList(),
    val shotList: ContentShotList? = null,
    val storyboardHandoff: ContentStoryboardHandoff? = null,
    val creationSheetOpen: Boolean = false,
    val creationInput: ContentCreationInput = ContentCreationInput(),
    val pendingTopicGenerationTaskId: String? = null,
    val dirtyCopyId: String? = null,
    val needsEditAfterReview: Boolean = false,
    val stage: ContentCreationStage = ContentCreationStage.Idle,
    val finalizing: Boolean = false,
    val loaded: Boolean = false,
    val error: String? = null
) {
    val canGenerateCopies: Boolean get() = selectedTopicId != null && stage == ContentCreationStage.TopicSelection
    val canSelectCopy: Boolean get() = stage == ContentCreationStage.CopyEditing && selectedCopyId != null
}

data class ContentCreationInput(
    val persona: String = "",
    val contentType: String = "",
    val style: String = "",
    val commercialLevel: Int = 1,
    val inspiration: String = ""
) {
    fun request() = CreateContentTaskRequest(persona, contentType, style, commercialLevel, inspiration.takeIf { it.isNotBlank() })
}

data class ContentStoryboardHandoff(val taskId: String, val shotListId: String)

class ContentCreationViewModel(private val repository: ContentCreationApi) : ViewModel() {
    private val mutableState = MutableStateFlow(ContentCreationState())
    val state: StateFlow<ContentCreationState> = mutableState.asStateFlow()

    fun load(storeId: String) = perform {
        mutableState.value = mutableState.value.copy(tasks = repository.listTasks(storeId), usageSummary = repository.loadUsageSummary(storeId), loaded = true)
    }

    fun restore(storeId: String, taskId: String) = perform {
        restoreTask(storeId, taskId)
    }

    fun create(storeId: String, request: CreateContentTaskRequest) = perform {
        val task = repository.createTask(storeId, request)
        refreshQueue(storeId)
        restoreTask(storeId, task.id)
    }

    fun openCreationSheet() {
        if (!mutableState.value.finalizing) mutableState.value = mutableState.value.copy(creationSheetOpen = true, error = null)
    }

    fun updateCreationInput(input: ContentCreationInput) {
        if (!mutableState.value.finalizing) mutableState.value = mutableState.value.copy(creationInput = input, error = null)
    }

    fun dismissCreationSheet() {
        if (!mutableState.value.finalizing) mutableState.value = mutableState.value.copy(creationSheetOpen = false, pendingTopicGenerationTaskId = null)
    }

    fun createAndGenerateTopics(storeId: String) = perform {
        val taskId = mutableState.value.pendingTopicGenerationTaskId ?: repository.createTask(storeId, mutableState.value.creationInput.request()).id.also { id ->
            mutableState.value = mutableState.value.copy(pendingTopicGenerationTaskId = id)
        }
        try {
            val topics = repository.generateTopics(storeId, taskId)
            if (topics.size != 3) throw ContentCreationRequestException("Generated topic options are invalid")
            refreshQueue(storeId)
            restoreTask(storeId, taskId)
            mutableState.value = mutableState.value.copy(creationSheetOpen = false, pendingTopicGenerationTaskId = null)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            recoverPendingTask(storeId, taskId)
            throw error
        }
    }

    fun generateTopics(storeId: String) = withTask { task ->
        repository.generateTopics(storeId, task.id)
        restoreTask(storeId, task.id)
    }

    fun selectTopic(topicId: String) {
        val task = mutableState.value.task ?: return
        if (mutableState.value.finalizing || task.topics.none { it.id == topicId }) return
        mutableState.value = mutableState.value.copy(
            selectedTopicId = topicId,
            selectedCopyId = null,
            reviewFindings = emptyList(),
            stage = ContentCreationStage.TopicSelection,
            error = null
        )
    }

    fun generateCopies(storeId: String) = withTask { task ->
        val topicId = mutableState.value.selectedTopicId ?: return@withTask
        repository.generateCopies(storeId, task.id, topicId)
        restoreTask(storeId, task.id)
    }

    fun selectCopy(copyId: String) {
        val current = mutableState.value
        val task = current.task ?: return
        if (current.finalizing || !hasValidCopyGroup(task, current.selectedTopicId)) return
        if (task.copies.none { it.id == copyId && it.topicId == current.selectedTopicId }) return
        mutableState.value = if (current.needsEditAfterReview) {
            current.copy(selectedCopyId = copyId, error = null)
        } else {
            current.copy(selectedCopyId = copyId, reviewFindings = emptyList(), stage = ContentCreationStage.CopyEditing, error = null)
        }
    }

    fun updateSelectedDraft(title: String, body: String) {
        val current = mutableState.value
        val task = current.task ?: return
        val copyId = current.selectedCopyId ?: return
        if (current.finalizing || title.isBlank() || body.isBlank()) return
        val existing = task.copies.firstOrNull { it.id == copyId } ?: return
        if (existing.title == title && existing.body == body) return
        val updated = task.copies.map { copy -> if (copy.id == copyId) copy.copy(title = title, body = body) else copy }
        mutableState.value = current.copy(task = task.copy(copies = updated), dirtyCopyId = copyId, needsEditAfterReview = false, reviewFindings = emptyList(), stage = ContentCreationStage.CopyEditing, error = null)
    }

    fun saveSelectedCopy(storeId: String) = withTask { task ->
        val copy = selectedCopy(task) ?: return@withTask
        repository.updateCopy(storeId, task.id, copy.id, UpdateContentCopyRequest(copy.title, copy.body))
        refreshQueue(storeId)
        restoreTask(storeId, task.id)
    }

    fun confirmSelectedCopy(storeId: String) = withTask { task ->
        val copy = selectedCopy(task) ?: return@withTask
        if (mutableState.value.stage != ContentCreationStage.CopyEditing) return@withTask
        if (mutableState.value.dirtyCopyId == copy.id) {
            repository.updateCopy(storeId, task.id, copy.id, UpdateContentCopyRequest(copy.title, copy.body))
        }
        when (val result = repository.confirmCopy(storeId, task.id, copy.id)) {
            is CopyConfirmationResult.Confirmed -> {
                refreshQueue(storeId)
                restoreTask(storeId, task.id)
            }
            is CopyConfirmationResult.RevisionRequired -> {
                mutableState.value = mutableState.value.copy(
                    task = task,
                    dirtyCopyId = null,
                    needsEditAfterReview = true,
                    reviewFindings = result.findings,
                    stage = ContentCreationStage.RevisionRequired,
                    loaded = true,
                    error = null
                )
                try {
                    refreshQueue(storeId)
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    mutableState.value = mutableState.value.copy(error = "暂时无法完成内容操作")
                }
            }
        }
    }

    fun generateShots(storeId: String) = withTask { task ->
        if (mutableState.value.stage != ContentCreationStage.Confirmed) return@withTask
        repository.generateShots(storeId, task.id)
        refreshQueue(storeId)
        restoreTask(storeId, task.id)
    }

    private fun withTask(block: suspend (ContentTaskDetail) -> Unit) = perform {
        val task = mutableState.value.task ?: return@perform
        block(task)
    }

    private fun perform(block: suspend () -> Unit) {
        if (mutableState.value.finalizing) return
        mutableState.value = mutableState.value.copy(finalizing = true, error = null)
        viewModelScope.launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                mutableState.value = mutableState.value.copy(error = "暂时无法完成内容操作", loaded = true)
            } finally {
                mutableState.value = mutableState.value.copy(finalizing = false)
            }
        }
    }

    private suspend fun restoreTask(storeId: String, taskId: String) {
        val task = repository.loadTask(storeId, taskId)
        val current = mutableState.value
        val recovered = recoveryFor(task, current.selectedCopyId)
        mutableState.value = current.copy(
            task = task,
            selectedTopicId = recovered.topicId,
            selectedCopyId = recovered.copyId,
            reviewFindings = task.reviewFindings.filter { finding -> finding.copyId == recovered.copyId },
            shotList = task.shotList,
            storyboardHandoff = task.shotList?.id?.trim()?.takeIf { it.isNotEmpty() }?.let { ContentStoryboardHandoff(task.id, it) },
            dirtyCopyId = null,
            needsEditAfterReview = false,
            stage = recovered.stage,
            loaded = true,
            error = null
        )
    }

    private fun selectedCopy(task: ContentTaskDetail): ContentCopy? =
        mutableState.value.selectedCopyId?.let { id -> task.copies.firstOrNull { it.id == id } }

    private data class Recovery(val topicId: String?, val copyId: String?, val stage: ContentCreationStage)

    private fun recoveryFor(task: ContentTaskDetail, preferredCopyId: String?): Recovery {
        task.shotList?.let { return Recovery(it.copyId.let { copyId -> task.copies.firstOrNull { it.id == copyId }?.topicId }, it.copyId, ContentCreationStage.StoryboardReady) }
        val confirmed = task.copies.firstOrNull { it.status == "confirmed" }
        if (confirmed != null) return Recovery(confirmed.topicId, confirmed.id, ContentCreationStage.Confirmed)
        if (task.copies.isEmpty()) return Recovery(null, null, if (task.topics.isEmpty()) ContentCreationStage.Idle else ContentCreationStage.TopicSelection)
        val validGroup = task.copies.groupBy { it.topicId }.entries.firstOrNull { (topicId, copies) ->
            task.topics.any { it.id == topicId } && isValidCopyGroup(copies)
        }
        if (validGroup == null) return Recovery(null, null, ContentCreationStage.TopicSelection)
        val selected = validGroup.value.firstOrNull { it.id == preferredCopyId } ?: validGroup.value.first()
        return Recovery(validGroup.key, selected.id, ContentCreationStage.CopyEditing)
    }

    private fun hasValidCopyGroup(task: ContentTaskDetail, topicId: String?): Boolean =
        topicId != null && task.copies.filter { it.topicId == topicId }.let(::isValidCopyGroup)

    private fun isValidCopyGroup(copies: List<ContentCopy>): Boolean =
        copies.size == 3 && copies.map { it.strategy.trim() }.toSet().size == 3

    private suspend fun refreshQueue(storeId: String) {
        mutableState.value = mutableState.value.copy(tasks = repository.listTasks(storeId))
    }

    private suspend fun recoverPendingTask(storeId: String, taskId: String) {
        try {
            refreshQueue(storeId)
            restoreTask(storeId, taskId)
            mutableState.value = mutableState.value.copy(pendingTopicGenerationTaskId = taskId, creationSheetOpen = true)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            mutableState.value = mutableState.value.copy(pendingTopicGenerationTaskId = taskId)
        }
    }

}
