package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentProfileModelsTest {
    @Test fun requiredProfileFieldsAreValidatedWithoutBlockingOptionalFields() {
        val profile = StoreContentProfile("store", "店", "fast_food", "rice", provinceCode = "sc", cityCode = "cd", districtCode = "sl", detailedAddress = "地址", businessDistrictType = "community", operatingMode = "dine_in")
        assertTrue(profile.missingRequiredFields().isEmpty())
        assertEquals(null, profile.categoryCustomName)
    }

    @Test fun missingRequiredProfileFieldsAreListed() {
        val profile = StoreContentProfile("store", "", "", "", provinceCode = "", cityCode = "", districtCode = "", detailedAddress = "", businessDistrictType = "", operatingMode = "")
        assertEquals(9, profile.missingRequiredFields().size)
    }
}
