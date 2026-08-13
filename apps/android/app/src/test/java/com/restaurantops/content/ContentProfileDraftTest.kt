package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentProfileDraftTest {
    @Test fun emptyDraftCannotSubmit() {
        val draft = ContentProfileDraft()
        assertFalse(draft.isComplete)
        assertTrue(draft.toProfile("store").missingRequiredFields().isNotEmpty())
    }

    @Test fun selectedRequiredValuesArePreservedInPayload() {
        val draft = ContentProfileDraft(storeName = "店", industryCode = "full_service", categoryCode = "sichuan", provinceCode = "sc", cityCode = "cd", districtCode = "sl", detailedAddress = "地址", businessDistrictType = "mall", operatingMode = "dine_in_takeaway")
        assertTrue(draft.isComplete)
        assertEquals("full_service", draft.toProfile("store").industryCode)
        assertEquals("mall", draft.toProfile("store").businessDistrictType)
    }
}
