package com.restaurantops.content

import org.junit.Assert.assertTrue
import org.junit.Test

class StoryboardVideoStateTest {
    @Test fun activeRenderStatesRequirePollingAndDeliveryFailuresAreVisible() {
        assertTrue(StoryboardVideoState(renders = listOf(StoryboardRender("r", "preview", RenderState.Queued))).hasActiveRender())
        assertTrue(StoryboardVideoState().withDeliveryUnavailable("expired").error == "expired")
    }
}
