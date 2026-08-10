package com.restaurantops.workspace

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceViewModelTest {
    @Test
    fun `restoration safely defaults unknown wire values and resolves legacy overlay conflicts`() {
        val legacyRestoredViewModel = WorkspaceViewModel(
            SavedStateHandle(
                mapOf(
                    "workspace_selected_tab" to "unknown-tab",
                    "workspace_video_stage" to "unknown-stage",
                    "workspace_is_diagnosis_open" to true,
                    "workspace_is_video_factory_open" to true
                )
            )
        )

        assertEquals(WorkspaceTab.HOME, legacyRestoredViewModel.selectedTab)
        assertEquals(VideoFactoryStage.TOPIC, legacyRestoredViewModel.videoStage)
        assertTrue(legacyRestoredViewModel.isDiagnosisOpen)
        assertFalse(legacyRestoredViewModel.isVideoFactoryOpen)

        val diagnosisRestoredViewModel = WorkspaceViewModel(
            SavedStateHandle(mapOf("workspace_overlay" to "diagnosis"))
        )
        assertTrue(diagnosisRestoredViewModel.isDiagnosisOpen)
        assertFalse(diagnosisRestoredViewModel.isVideoFactoryOpen)

        val videoRestoredViewModel = WorkspaceViewModel(
            SavedStateHandle(mapOf("workspace_overlay" to "video-factory"))
        )
        assertFalse(videoRestoredViewModel.isDiagnosisOpen)
        assertTrue(videoRestoredViewModel.isVideoFactoryOpen)

        val unknownOverlayRestoredViewModel = WorkspaceViewModel(
            SavedStateHandle(mapOf("workspace_overlay" to "unknown-overlay"))
        )
        assertFalse(unknownOverlayRestoredViewModel.isDiagnosisOpen)
        assertFalse(unknownOverlayRestoredViewModel.isVideoFactoryOpen)
    }

    @Test
    fun `workspace state persists explicit wire values and tasks are not exposed as mutable snapshot state`() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)

        viewModel.selectTab(WorkspaceTab.TASKS)
        viewModel.advanceVideoStage()
        viewModel.openVideoFactory()
        viewModel.createPriorityTask()

        assertEquals("tasks", WorkspaceTab.TASKS.wireValue)
        assertEquals("copy", VideoFactoryStage.COPY.wireValue)
        assertEquals("tasks", handle.get<String>("workspace_selected_tab"))
        assertEquals("copy", handle.get<String>("workspace_video_stage"))
        assertEquals("video-factory", handle.get<String>("workspace_overlay"))
        assertEquals(List::class.java, WorkspaceViewModel::class.java.getMethod("getTasks").returnType)
    }

    @Test
    fun `priority task and selected tab restore from saved state`() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)

        viewModel.createPriorityTask()
        viewModel.selectTab(WorkspaceTab.TASKS)

        val restoredViewModel = WorkspaceViewModel(handle)

        assertEquals(WorkspaceTab.TASKS, restoredViewModel.selectedTab)
        assertEquals(1, restoredViewModel.tasks.size)
        assertEquals("检查午市套餐曝光与核销承接", restoredViewModel.tasks.single().title)
    }

    @Test
    fun `video factory stage topic and copy restore from saved state`() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)

        viewModel.openVideoFactory()
        viewModel.selectTopic("午市双人套餐")
        viewModel.updateCopyDraft("今天的双人套餐，适合午休快速开吃。")
        viewModel.advanceVideoStage()

        val restoredViewModel = WorkspaceViewModel(handle)

        assertEquals(VideoFactoryStage.COPY, restoredViewModel.videoStage)
        assertEquals("午市双人套餐", restoredViewModel.selectedTopic)
        assertEquals("今天的双人套餐，适合午休快速开吃。", restoredViewModel.copyDraft)
    }

    @Test
    fun `video stage remains within the available stage range`() {
        val viewModel = WorkspaceViewModel(SavedStateHandle())

        viewModel.retreatVideoStage()
        assertEquals(VideoFactoryStage.TOPIC, viewModel.videoStage)

        repeat(VideoFactoryStage.entries.size + 1) { viewModel.advanceVideoStage() }
        assertEquals(VideoFactoryStage.LIBRARY, viewModel.videoStage)
    }

    @Test
    fun `priority task is unique and uses the required assignment details`() {
        val viewModel = WorkspaceViewModel(SavedStateHandle())

        viewModel.createPriorityTask()
        viewModel.createPriorityTask()

        assertEquals(1, viewModel.tasks.size)
        assertEquals(
            LocalActionTask(
                title = "检查午市套餐曝光与核销承接",
                owner = "店长",
                dueDate = "明日午市前",
                metric = "套餐核销率"
            ),
            viewModel.tasks.single()
        )
    }

    @Test
    fun `overlay state is exclusive and close persists both overlays as closed`() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)

        viewModel.openDiagnosis()
        assertTrue(viewModel.isDiagnosisOpen)
        assertFalse(viewModel.isVideoFactoryOpen)

        viewModel.openVideoFactory()
        assertFalse(viewModel.isDiagnosisOpen)
        assertTrue(viewModel.isVideoFactoryOpen)

        viewModel.closeOverlay()
        val restoredViewModel = WorkspaceViewModel(handle)

        assertFalse(restoredViewModel.isDiagnosisOpen)
        assertFalse(restoredViewModel.isVideoFactoryOpen)
    }
}
