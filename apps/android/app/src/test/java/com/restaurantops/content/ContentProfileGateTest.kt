package com.restaurantops.content

import org.junit.Assert.assertEquals
import org.junit.Test

class ContentProfileGateTest {
    @Test fun incompleteOrMissingServerProfileCannotOpenContentPlanning() {
        val local = StoreContentProfile("store", "name", "fast_food", "rice_noodle", provinceCode = "sc", cityCode = "cd", districtCode = "sl", detailedAddress = "address", businessDistrictType = "community", operatingMode = "dine_in", requiredComplete = false)
        assertEquals(ContentProfileGate.NeedsProfile, contentProfileGate(ContentProfileState()))
        assertEquals(ContentProfileGate.NeedsProfile, contentProfileGate(ContentProfileState(profile = local)))
        assertEquals(ContentProfileGate.Ready, contentProfileGate(ContentProfileState(profile = local.copy(requiredComplete = true))))
    }
}
