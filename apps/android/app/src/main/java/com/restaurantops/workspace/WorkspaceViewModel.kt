package com.restaurantops.workspace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel

class WorkspaceViewModel(
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {
    var selectedTab by mutableStateOf(
        savedStateHandle.get<String>(SELECTED_TAB)?.let(WorkspaceTab::valueOf) ?: WorkspaceTab.HOME
    )
        private set

    var isDiagnosisOpen by mutableStateOf(savedStateHandle.get<Boolean>(IS_DIAGNOSIS_OPEN) ?: false)
        private set

    var isVideoFactoryOpen by mutableStateOf(savedStateHandle.get<Boolean>(IS_VIDEO_FACTORY_OPEN) ?: false)
        private set

    val tasks = mutableStateListOf<LocalActionTask>().apply {
        if (savedStateHandle.get<Boolean>(HAS_PRIORITY_TASK) == true) {
            add(PRIORITY_TASK)
        }
    }

    var videoStage by mutableStateOf(
        savedStateHandle.get<String>(VIDEO_STAGE)?.let(VideoFactoryStage::valueOf) ?: VideoFactoryStage.TOPIC
    )
        private set

    var selectedTopic by mutableStateOf(savedStateHandle[SELECTED_TOPIC] ?: "")
        private set

    var copyDraft by mutableStateOf(savedStateHandle[COPY_DRAFT] ?: "")
        private set

    fun selectTab(tab: WorkspaceTab) {
        selectedTab = tab
        savedStateHandle[SELECTED_TAB] = tab.name
    }

    fun createPriorityTask() {
        if (tasks.none { it.title == PRIORITY_TASK.title }) {
            tasks.add(PRIORITY_TASK)
            savedStateHandle[HAS_PRIORITY_TASK] = true
        }
    }

    fun openDiagnosis() {
        isDiagnosisOpen = true
        isVideoFactoryOpen = false
        savedStateHandle[IS_DIAGNOSIS_OPEN] = true
        savedStateHandle[IS_VIDEO_FACTORY_OPEN] = false
    }

    fun closeOverlay() {
        isDiagnosisOpen = false
        isVideoFactoryOpen = false
        savedStateHandle[IS_DIAGNOSIS_OPEN] = false
        savedStateHandle[IS_VIDEO_FACTORY_OPEN] = false
    }

    fun openVideoFactory() {
        isDiagnosisOpen = false
        isVideoFactoryOpen = true
        savedStateHandle[IS_DIAGNOSIS_OPEN] = false
        savedStateHandle[IS_VIDEO_FACTORY_OPEN] = true
    }

    fun advanceVideoStage() = updateVideoStage(
        VideoFactoryStage.entries[(videoStage.ordinal + 1).coerceAtMost(VideoFactoryStage.entries.lastIndex)]
    )

    fun retreatVideoStage() = updateVideoStage(
        VideoFactoryStage.entries[(videoStage.ordinal - 1).coerceAtLeast(0)]
    )

    fun selectTopic(topic: String) {
        selectedTopic = topic
        savedStateHandle[SELECTED_TOPIC] = topic
    }

    fun updateCopyDraft(copy: String) {
        copyDraft = copy
        savedStateHandle[COPY_DRAFT] = copy
    }

    private fun updateVideoStage(stage: VideoFactoryStage) {
        videoStage = stage
        savedStateHandle[VIDEO_STAGE] = stage.name
    }

    private companion object {
        const val SELECTED_TAB = "workspace_selected_tab"
        const val IS_DIAGNOSIS_OPEN = "workspace_is_diagnosis_open"
        const val IS_VIDEO_FACTORY_OPEN = "workspace_is_video_factory_open"
        const val HAS_PRIORITY_TASK = "workspace_has_priority_task"
        const val VIDEO_STAGE = "workspace_video_stage"
        const val SELECTED_TOPIC = "workspace_selected_topic"
        const val COPY_DRAFT = "workspace_copy_draft"

        val PRIORITY_TASK = LocalActionTask(
            title = "检查午市套餐曝光与核销承接",
            owner = "店长",
            dueDate = "明日午市前",
            metric = "套餐核销率"
        )
    }
}
