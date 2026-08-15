package com.restaurantops.workspace

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceViewModelTest {
    @Test fun contentCreationTabRestoresForTheCustomerWorkspace() {
        val handle = SavedStateHandle()
        WorkspaceViewModel(handle).selectTab(WorkspaceTab.CONTENT_CREATION)

        assertEquals(WorkspaceTab.CONTENT_CREATION, WorkspaceViewModel(handle).selectedTab)
    }

    @Test fun legacyVideoFactoryOverlayDoesNotRestore() {
        val viewModel = WorkspaceViewModel(SavedStateHandle(mapOf("workspace_overlay" to "video-factory")))

        assertFalse(viewModel.isDiagnosisOpen)
        assertFalse(viewModel.isStoryboardOpen)
        assertFalse(viewModel.isImportOpen)
    }

    @Test fun storyboardOverlayRetainsTheActualStoryboardEditorRoute() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)

        viewModel.openStoryboard()

        assertTrue(viewModel.isStoryboardOpen)
        assertEquals("storyboard", handle.get<String>("workspace_overlay"))
    }

    @Test fun operationsTabRestoresConfirmedPeriodAndClosesOverlays() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)
        viewModel.openImport()

        viewModel.openOperations("2026-08-01", "2026-08-07")

        assertEquals(WorkspaceTab.OPERATIONS, viewModel.selectedTab)
        assertEquals(OperationsPeriod("2026-08-01", "2026-08-07"), viewModel.selectedOperationsPeriod)
        assertFalse(viewModel.isImportOpen)
    }

    @Test fun priorityTaskIsDeduplicatedAndRestored() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)

        viewModel.createPriorityTask()
        viewModel.createPriorityTask()

        assertEquals(1, viewModel.tasks.size)
        assertEquals(viewModel.tasks, WorkspaceViewModel(handle).tasks)
    }

    @Test fun importOverlayClosesAndDoesNotRestore() {
        val handle = SavedStateHandle()
        val viewModel = WorkspaceViewModel(handle)
        viewModel.openImport()
        viewModel.closeOverlay()

        val restored = WorkspaceViewModel(handle)
        assertFalse(restored.isImportOpen)
        assertFalse(restored.isDiagnosisOpen)
        assertFalse(restored.isStoryboardOpen)
    }

    @Test fun invalidOperationsDatesAreClearedDuringRestoration() {
        val handle = SavedStateHandle(mapOf(
            "workspace_operations_range_start" to "2026-08-08",
            "workspace_operations_range_end" to "2026-08-01"
        ))

        assertEquals(null, WorkspaceViewModel(handle).selectedOperationsPeriod)
        assertEquals(null, handle.get<String>("workspace_operations_range_start"))
        assertEquals(null, handle.get<String>("workspace_operations_range_end"))
    }

    @Test fun overlaysRemainMutuallyExclusive() {
        val viewModel = WorkspaceViewModel(SavedStateHandle())
        viewModel.openDiagnosis()
        viewModel.openImport()

        assertFalse(viewModel.isDiagnosisOpen)
        assertTrue(viewModel.isImportOpen)
        assertFalse(viewModel.isStoryboardOpen)
    }

    @Test fun workspaceTabsMapContentCreationAndUnknownValues() {
        assertEquals(WorkspaceTab.CONTENT_CREATION, WorkspaceTab.fromWireValue("content-creation"))
        assertEquals("内容创作", WorkspaceTab.CONTENT_CREATION.title)
        assertEquals(WorkspaceTab.HOME, WorkspaceTab.fromWireValue("unknown"))
    }
}
