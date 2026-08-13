package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class ContentProfileHttpClientContractTest {
    @Test fun requestDtosKeepCustomerFieldsSeparateFromServerOwnedFields() {
        val response = ContentProfileResponse(
            StoreContentProfile("s", "name", "fast_food", "rice_noodle", provinceCode = "sc", cityCode = "cd", districtCode = "sl", detailedAddress = "addr", businessDistrictType = "community", operatingMode = "dine_in", enterpriseId = "ent", version = 2),
            completenessRequired = true,
            missing = emptyList()
        )
        assertEquals("ent", response.profile.enterpriseId)
        assertEquals(2, response.profile.version)
        assertEquals(true, response.completenessRequired)
    }
}
