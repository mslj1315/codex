package com.restaurantops.content

interface ContentProfileRepository {
    suspend fun getProfile(storeId: String): StoreContentProfile
    suspend fun createProfile(storeId: String, profile: StoreContentProfile): StoreContentProfile
    suspend fun updateProfile(storeId: String, profile: StoreContentProfile): StoreContentProfile
    suspend fun listOperatingStages(storeId: String): List<OperatingStage>
    suspend fun addOperatingStage(storeId: String, stage: OperatingStage): OperatingStage
}
