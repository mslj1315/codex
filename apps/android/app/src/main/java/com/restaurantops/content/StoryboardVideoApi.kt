package com.restaurantops.content

interface StoryboardVideoApi {
    suspend fun createUploadGrant(storeId: String, taskId: String, shotListId: String, source: GalleryVideo): UploadGrant
    suspend fun completeUpload(storeId: String, taskId: String, shotListId: String, assetId: String): UploadedAsset
    suspend fun createProject(storeId: String, taskId: String, shotListId: String): StoryboardDraft
    suspend fun loadProject(storeId: String, taskId: String, shotListId: String, projectId: String): StoryboardDraft
    suspend fun saveProject(storeId: String, taskId: String, shotListId: String, draft: StoryboardDraft, finalize: Boolean): StoryboardDraft
    suspend fun createRender(storeId: String, taskId: String, shotListId: String, projectId: String, kind: String): StoryboardRender
    suspend fun listRenders(storeId: String, taskId: String, shotListId: String, projectId: String): List<StoryboardRender>
    suspend fun cancelRender(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String): StoryboardRender
    suspend fun deleteRender(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String)
    suspend fun selectCover(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String, candidateId: String, title: String): StoryboardRender
}
data class UploadGrant(val assetId: String, val uploadUrl: String, val expiresAt: String)
data class UploadedAsset(val id: String, val displayName: String, val durationSeconds: Int)
interface DirectVideoUploader { suspend fun upload(grant: UploadGrant, source: GalleryVideo) }
interface StoryboardVideoRepository {
    suspend fun upload(storeId: String, taskId: String, shotListId: String, source: GalleryVideo): UploadedAsset
    suspend fun createProject(storeId: String, taskId: String, shotListId: String): StoryboardDraft
    suspend fun loadProject(storeId: String, taskId: String, shotListId: String, projectId: String): StoryboardDraft
    suspend fun saveProject(storeId: String, taskId: String, shotListId: String, draft: StoryboardDraft, finalize: Boolean = false): StoryboardDraft
    suspend fun createRender(storeId: String, taskId: String, shotListId: String, projectId: String, kind: String): StoryboardRender
    suspend fun listRenders(storeId: String, taskId: String, shotListId: String, projectId: String): List<StoryboardRender>
    suspend fun cancelRender(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String): StoryboardRender
    suspend fun deleteRender(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String)
    suspend fun selectCover(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String, candidateId: String, title: String): StoryboardRender
}
class HttpStoryboardVideoRepository(private val api: StoryboardVideoApi, private val uploader: DirectVideoUploader) : StoryboardVideoRepository {
    override suspend fun upload(storeId: String, taskId: String, shotListId: String, source: GalleryVideo): UploadedAsset { val grant = api.createUploadGrant(storeId, taskId, shotListId, source); uploader.upload(grant, source); return api.completeUpload(storeId, taskId, shotListId, grant.assetId) }
    override suspend fun createProject(storeId: String, taskId: String, shotListId: String) = api.createProject(storeId, taskId, shotListId)
    override suspend fun loadProject(storeId: String, taskId: String, shotListId: String, projectId: String) = api.loadProject(storeId, taskId, shotListId, projectId)
    override suspend fun saveProject(storeId: String, taskId: String, shotListId: String, draft: StoryboardDraft, finalize: Boolean) = api.saveProject(storeId, taskId, shotListId, draft, finalize)
    override suspend fun createRender(storeId: String, taskId: String, shotListId: String, projectId: String, kind: String) = api.createRender(storeId, taskId, shotListId, projectId, kind)
    override suspend fun listRenders(storeId: String, taskId: String, shotListId: String, projectId: String) = api.listRenders(storeId, taskId, shotListId, projectId)
    override suspend fun cancelRender(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String) = api.cancelRender(storeId, taskId, shotListId, projectId, renderId)
    override suspend fun deleteRender(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String) = api.deleteRender(storeId, taskId, shotListId, projectId, renderId)
    override suspend fun selectCover(storeId: String, taskId: String, shotListId: String, projectId: String, renderId: String, candidateId: String, title: String) = api.selectCover(storeId, taskId, shotListId, projectId, renderId, candidateId, title)
}
