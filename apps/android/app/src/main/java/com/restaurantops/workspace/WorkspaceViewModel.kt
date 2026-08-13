package com.restaurantops.workspace

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import java.time.LocalDate

data class OperationsPeriod(val rangeStart: String, val rangeEnd: String)

class WorkspaceViewModel(
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {
    var selectedTab by mutableStateOf(
        WorkspaceTab.fromWireValue(savedStateHandle[SELECTED_TAB])
    )
        private set

    var selectedOperationsPeriod by mutableStateOf(restoreOperationsPeriod())
        private set

    private val restoredOverlay = restoreOverlay()

    var isDiagnosisOpen by mutableStateOf(restoredOverlay == WorkspaceOverlay.DIAGNOSIS)
        private set

    var isVideoFactoryOpen by mutableStateOf(restoredOverlay == WorkspaceOverlay.VIDEO_FACTORY)
        private set

    var isImportOpen by mutableStateOf(restoredOverlay == WorkspaceOverlay.IMPORT)
        private set

    private val mutableTasks = mutableStateListOf<LocalActionTask>().apply {
        if (savedStateHandle.get<Boolean>(HAS_PRIORITY_TASK) == true) {
            add(PRIORITY_TASK)
        }
    }

    val tasks: List<LocalActionTask>
        get() = mutableTasks.toList()

    var videoStage by mutableStateOf(
        VideoFactoryStage.fromWireValue(savedStateHandle[VIDEO_STAGE])
    )
        private set

    var selectedTopic by mutableStateOf(savedStateHandle[SELECTED_TOPIC] ?: "")
        private set

    var copyDraft by mutableStateOf(savedStateHandle[COPY_DRAFT] ?: "")
        private set

    fun selectTab(tab: WorkspaceTab) {
        selectedTab = tab
        savedStateHandle[SELECTED_TAB] = tab.wireValue
    }

    fun openOperations(rangeStart: String, rangeEnd: String) {
        requireValidOperationsPeriod(rangeStart, rangeEnd)
        selectedOperationsPeriod = OperationsPeriod(rangeStart, rangeEnd)
        savedStateHandle[OPERATIONS_RANGE_START] = rangeStart
        savedStateHandle[OPERATIONS_RANGE_END] = rangeEnd
        selectTab(WorkspaceTab.OPERATIONS)
        closeOverlay()
    }

    fun createPriorityTask() {
        if (mutableTasks.none { it.title == PRIORITY_TASK.title }) {
            mutableTasks.add(PRIORITY_TASK)
            savedStateHandle[HAS_PRIORITY_TASK] = true
        }
    }

    fun createPriorityTaskAndOpenTasks() {
        createPriorityTask()
        selectTab(WorkspaceTab.TASKS)
        closeOverlay()
    }

    fun openDiagnosis() {
        isDiagnosisOpen = true
        isVideoFactoryOpen = false
        isImportOpen = false
        savedStateHandle[OVERLAY] = WorkspaceOverlay.DIAGNOSIS.wireValue
    }

    fun closeOverlay() {
        isDiagnosisOpen = false
        isVideoFactoryOpen = false
        isImportOpen = false
        savedStateHandle[OVERLAY] = WorkspaceOverlay.NONE.wireValue
    }

    fun openVideoFactory() {
        isDiagnosisOpen = false
        isVideoFactoryOpen = true
        isImportOpen = false
        savedStateHandle[OVERLAY] = WorkspaceOverlay.VIDEO_FACTORY.wireValue
    }

    fun openImport() {
        isDiagnosisOpen = false
        isVideoFactoryOpen = false
        isImportOpen = true
        savedStateHandle[OVERLAY] = WorkspaceOverlay.IMPORT.wireValue
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
        savedStateHandle[VIDEO_STAGE] = stage.wireValue
    }

    private fun restoreOverlay(): WorkspaceOverlay {
        val persistedOverlay = savedStateHandle.get<String>(OVERLAY)
        if (persistedOverlay != null) {
            val restoredOverlay = WorkspaceOverlay.fromWireValue(persistedOverlay)
            if (restoredOverlay == WorkspaceOverlay.IMPORT) {
                savedStateHandle[OVERLAY] = WorkspaceOverlay.NONE.wireValue
                return WorkspaceOverlay.NONE
            }
            return restoredOverlay
        }

        return when {
            savedStateHandle.get<Boolean>(IS_DIAGNOSIS_OPEN) == true -> WorkspaceOverlay.DIAGNOSIS
            savedStateHandle.get<Boolean>(IS_VIDEO_FACTORY_OPEN) == true -> WorkspaceOverlay.VIDEO_FACTORY
            else -> WorkspaceOverlay.NONE
        }
    }

    private fun restoreOperationsPeriod(): OperationsPeriod? {
        val rangeStart = savedStateHandle.get<String>(OPERATIONS_RANGE_START) ?: return null
        val rangeEnd = savedStateHandle.get<String>(OPERATIONS_RANGE_END) ?: return null
        return try {
            requireValidOperationsPeriod(rangeStart, rangeEnd)
            OperationsPeriod(rangeStart, rangeEnd)
        } catch (_: IllegalArgumentException) {
            savedStateHandle[OPERATIONS_RANGE_START] = null
            savedStateHandle[OPERATIONS_RANGE_END] = null
            null
        }
    }

    private fun requireValidOperationsPeriod(rangeStart: String, rangeEnd: String) {
        require(!LocalDate.parse(rangeStart).isAfter(LocalDate.parse(rangeEnd)))
    }

    private companion object {
        const val SELECTED_TAB = "workspace_selected_tab"
        const val OPERATIONS_RANGE_START = "workspace_operations_range_start"
        const val OPERATIONS_RANGE_END = "workspace_operations_range_end"
        const val OVERLAY = "workspace_overlay"
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

    private enum class WorkspaceOverlay(val wireValue: String) {
        NONE("none"),
        DIAGNOSIS("diagnosis"),
        VIDEO_FACTORY("video-factory"),
        IMPORT("import");

        companion object {
            fun fromWireValue(value: String): WorkspaceOverlay =
                entries.firstOrNull { it.wireValue == value } ?: NONE
        }
    }
}
