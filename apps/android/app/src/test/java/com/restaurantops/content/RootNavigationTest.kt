package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import com.restaurantops.workspace.WorkspaceTab

class RootNavigationTest {
    @Test fun workspaceExposesCustomerContentCreationDestination() {
        val destination = WorkspaceTab.entries.single { it.wireValue == "content-creation" }

        assertEquals("内容创作", destination.title)
        assertTrue(destination.isCustomerContentCreation)
    }

    @Test fun actualRootTransitionCannotBypassProfileGate() {
        assertEquals(RootScreen.PROFILE, nextRootScreen(RootScreen.ONBOARDING, ContentProfileGate.NeedsProfile))
        assertEquals(RootScreen.PROFILE, nextRootScreen(RootScreen.PROFILE, ContentProfileGate.NeedsProfile))
        assertEquals(RootScreen.WORKSPACE, nextRootScreen(RootScreen.PROFILE, ContentProfileGate.Ready))
        assertEquals(RootScreen.PROFILE, nextRootScreen(RootScreen.WORKSPACE, ContentProfileGate.NeedsProfile))
    }
}
