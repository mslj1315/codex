package com.restaurantops.content

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentCreationScreenTest {
    @Test fun quickStartSubmitRequiresTheThreeServerCreationFieldsUnlessRetryingTopics() {
        assertFalse(contentCreationCanSubmit(ContentCreationInput(), pendingTopicGeneration = false))
        assertFalse(contentCreationCanSubmit(ContentCreationInput(persona = "店长", contentType = "短视频"), pendingTopicGeneration = false))
        assertTrue(contentCreationCanSubmit(ContentCreationInput(persona = "店长", contentType = "短视频", style = "真实"), pendingTopicGeneration = false))
        assertTrue(contentCreationCanSubmit(ContentCreationInput(), pendingTopicGeneration = true))
    }
}
