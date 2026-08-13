package com.restaurantops.content

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class ContentProfileRepositoryTest {
    @Test fun httpRepositoryDelegatesProfileAndStageContracts() = runBlocking {
        val profile = StoreContentProfile("store", "店", "fast_food", "rice", provinceCode = "sc", cityCode = "cd", districtCode = "sl", detailedAddress = "地址", businessDistrictType = "community", operatingMode = "dine_in")
        val stage = OperatingStage("2026-08-14", "acquire_customers")
        val api = object : ContentProfileApi {
            override suspend fun getProfile(storeId: String) = profile
            override suspend fun createProfile(storeId: String, profile: StoreContentProfile) = profile
            override suspend fun updateProfile(storeId: String, profile: StoreContentProfile) = profile
            override suspend fun listOperatingStages(storeId: String) = listOf(stage)
            override suspend fun createOperatingStage(storeId: String, stage: OperatingStage) = stage
        }
        val repository = ContentProfileHttpRepository(api)
        assertEquals(profile, repository.getProfile("store"))
        assertEquals(stage, repository.addOperatingStage("store", stage))
    }
}
