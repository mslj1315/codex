package com.restaurantops.content

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentCreationScreenTest {
    @Test fun idleTaskExposesGenerateTopicsActionAndDisablesItWhileFinalizing() {
        var generated = false
        val ready = contentCreationWorkspaceActions(ContentCreationState(stage = ContentCreationStage.Idle), onGenerateTopics = { generated = true })

        assertEquals("生成选题", ready.single().label)
        assertTrue(ready.single().enabled)
        ready.single().invoke()
        assertTrue(generated)
        assertFalse(contentCreationWorkspaceActions(ContentCreationState(stage = ContentCreationStage.Idle, finalizing = true), onGenerateTopics = {}).single().enabled)
    }
    @Test fun contentUiMapsQueueCreationReviewAndStoryboardStatesWithoutOpeningUnsafeActions() {
        assertEquals(ContentCreationScreenMode.Queue, contentCreationScreenMode(ContentCreationState()))
        assertEquals(ContentCreationScreenMode.Creating, contentCreationScreenMode(ContentCreationState(creationSheetOpen = true)))
        assertEquals(ContentCreationScreenMode.ThreeCopies, contentCreationScreenMode(ContentCreationState(stage = ContentCreationStage.CopyEditing)))
        assertEquals(ContentCreationScreenMode.ReviewBlocked, contentCreationScreenMode(ContentCreationState(stage = ContentCreationStage.RevisionRequired)))
        assertEquals(ContentCreationScreenMode.StoryboardHandoff, contentCreationScreenMode(ContentCreationState(stage = ContentCreationStage.StoryboardReady)))
    }

    @Test fun quickStartSubmitRequiresTheThreeServerCreationFieldsUnlessRetryingTopics() {
        assertFalse(contentCreationCanSubmit(ContentCreationInput(), pendingTopicGeneration = false))
        assertFalse(contentCreationCanSubmit(ContentCreationInput(persona = "店长", contentType = "短视频"), pendingTopicGeneration = false))
        assertTrue(contentCreationCanSubmit(ContentCreationInput(persona = "店长", contentType = "短视频", style = "真实"), pendingTopicGeneration = false))
        assertTrue(contentCreationCanSubmit(ContentCreationInput(), pendingTopicGeneration = true))
    }
}
