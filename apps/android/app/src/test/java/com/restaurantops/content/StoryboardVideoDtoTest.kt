package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class StoryboardVideoDtoTest {
    @Test fun parsesNestedUploadAndCompletionResponsesWithoutStorageFields() {
        assertEquals("https://upload.example/put", uploadGrantFrom(mapOf("assetId" to "asset", "upload" to mapOf("url" to "https://upload.example/put"), "expiresAt" to "2026-08-20T00:00:00Z")).uploadUrl)
        assertEquals("asset", uploadedAssetFrom(mapOf("id" to "asset")).id)
    }
    @Test fun parsesCoverSelectionDtoInsteadOfRender() { assertEquals("cover", coverSelectionFrom(mapOf("selectedCoverCandidateId" to "cover", "selectedCoverTitle" to "Lunch")).candidateId) }
    @Test fun shotSlotsKeepImmutableShotIndexWhileSupplementalSlotsOmitIt() {
        assertEquals(2, StoryboardSlot("shot", 1, kind = "shot", shotIndex = 2).shotIndex)
        assertEquals(null, StoryboardSlot("extra", 2, kind = "supplemental").shotIndex)
    }
}
