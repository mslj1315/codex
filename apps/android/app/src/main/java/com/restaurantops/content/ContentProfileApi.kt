package com.restaurantops.content

interface ContentProfileApi {
    suspend fun getProfile(storeId: String): StoreContentProfile
    suspend fun createProfile(storeId: String, profile: StoreContentProfile): StoreContentProfile
    suspend fun updateProfile(storeId: String, profile: StoreContentProfile): StoreContentProfile
    suspend fun listOperatingStages(storeId: String): List<OperatingStage>
    suspend fun createOperatingStage(storeId: String, stage: OperatingStage): OperatingStage
}

class ContentProfileHttpRepository(private val api: ContentProfileApi) : ContentProfileRepository {
    override suspend fun getProfile(storeId: String) = api.getProfile(storeId)
    override suspend fun createProfile(storeId: String, profile: StoreContentProfile) = api.createProfile(storeId, profile)
    override suspend fun updateProfile(storeId: String, profile: StoreContentProfile) = api.updateProfile(storeId, profile)
    override suspend fun listOperatingStages(storeId: String) = api.listOperatingStages(storeId)
    override suspend fun addOperatingStage(storeId: String, stage: OperatingStage) = api.createOperatingStage(storeId, stage)
}
