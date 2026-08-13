package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class RootNavigationTest {
    @Test fun rootNavigationIsMutuallyExclusiveAndCannotBypassProfileGate() {
        assertEquals(RootScreen.PROFILE, nextRootScreen(RootScreen.ONBOARDING, ContentProfileGate.NeedsProfile))
        assertEquals(RootScreen.PROFILE, nextRootScreen(RootScreen.PROFILE, ContentProfileGate.NeedsProfile))
        assertEquals(RootScreen.WORKSPACE, nextRootScreen(RootScreen.PROFILE, ContentProfileGate.Ready))
        assertEquals(RootScreen.PROFILE, nextRootScreen(RootScreen.WORKSPACE, ContentProfileGate.NeedsProfile))
    }
}
