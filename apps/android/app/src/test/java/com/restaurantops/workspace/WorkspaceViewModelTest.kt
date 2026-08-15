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
}
