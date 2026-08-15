package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class StoryboardVideoDtoTest {
    @Test fun parsesNestedUploadAndCompletionResponsesWithoutStorageFields() {
        assertEquals("https://upload.example/put", uploadGrantFrom(mapOf("assetId" to "asset", "upload" to mapOf("url" to "https://upload.example/put"), "expiresAt" to "2026-08-20T00:00:00Z")).uploadUrl)
        assertEquals("asset", uploadedAssetFrom(mapOf("id" to "asset")).id)
    }
    @Test fun parsesCoverSelectionDtoInsteadOfRender() { assertEquals("cover", coverSelectionFrom(mapOf("selectedCoverCandidateId" to "cover", "selectedCoverTitle" to "Lunch")).candidateId) }
}
