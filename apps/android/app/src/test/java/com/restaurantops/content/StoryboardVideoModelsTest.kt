package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class StoryboardVideoModelsTest {
    @Test fun sourceLimitsRejectTwentyFirstOversizedAndOverlongSelections() {
        val sources = (1..20).map { GalleryVideo("$it", "clip-$it.mp4", 500L * 1024 * 1024, 30) }
        assertTrue(StoryboardUploadPolicy.validate(sources).isAllowed)
        assertFalse(StoryboardUploadPolicy.validate(sources + GalleryVideo("21", "extra.mp4", 1, 1)).isAllowed)
        assertFalse(StoryboardUploadPolicy.validate(listOf(GalleryVideo("big", "big.mp4", 501L * 1024 * 1024, 1))).isAllowed)
        assertFalse(StoryboardUploadPolicy.validate(listOf(GalleryVideo("long", "long.mp4", 1, 601))).isAllowed)
    }

    @Test fun failedUploadCanBeRecoveredWithoutLosingSelectedSource() {
        val failed = UploadItem(GalleryVideo("one", "one.mp4", 10, 4), UploadState.Failed, "network")
        assertEquals(UploadState.ReadyToRetry, failed.recover().state)
        assertEquals("one", failed.recover().source.id)
    }

    @Test fun slotEditsPersistTrimMuteSubtitleAndOrder() {
        val slots = listOf(StoryboardSlot("a", 1, assetId = "asset", trimStartSeconds = 1, trimEndSeconds = 4, muted = true, subtitleEnabled = true, subtitleText = "fresh"))
        val draft = StoryboardDraft("project", 3, slots)
        assertTrue(draft.isRenderable())
        assertEquals("fresh", draft.slots.single().subtitleText)
        assertTrue(draft.slots.single().muted)
        assertEquals(1, draft.slots.single().trimStartSeconds)
    }

    @Test fun renderStateAndExpiryMessagingRemainCustomerControlled() {
        assertTrue(StoryboardRender("r", "preview", RenderState.Queued).canCancel)
        assertFalse(StoryboardRender("r", "final", RenderState.Succeeded, expiresAt = "2026-08-20T00:00:00Z").canCancel)
        assertEquals("Preview expires after 7 days.", renderExpiryMessage("preview"))
        assertEquals("Final video expires after 180 days.", renderExpiryMessage("final"))
        assertFalse(StoryboardCustomerActions.entries.any { it.name == "Publish" })
    }
}
