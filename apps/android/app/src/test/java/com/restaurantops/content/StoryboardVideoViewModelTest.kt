package com.restaurantops.content

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class StoryboardVideoViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test fun draftPreviewFinalizesOnceAndRecoveredFinalQueuesDirectly() = runTest(dispatcher) {
        val repo = FakeStoryboardRepository(StoryboardDraft("project", 1, listOf(StoryboardSlot("slot", 1, assetId = "asset", trimEndSeconds = 1)), status = "draft"))
        val vm = StoryboardVideoViewModel(repo)
        vm.createProject("store", "task", "shots"); advanceUntilIdle()
        vm.requestRender("store", "task", "shots", "preview"); advanceUntilIdle()
        vm.requestRender("store", "task", "shots", "final"); advanceUntilIdle()
        assertEquals(listOf(true), repo.finalizeCalls)
        assertEquals(listOf("preview", "final"), repo.renderCalls)
    }
}

private class FakeStoryboardRepository(private var draft: StoryboardDraft) : StoryboardVideoRepository {
    val finalizeCalls = mutableListOf<Boolean>(); val renderCalls = mutableListOf<String>()
    override suspend fun upload(storeId:String,taskId:String,shotListId:String,source:GalleryVideo)=UploadedAsset("asset","asset",1)
    override suspend fun createProject(storeId:String,taskId:String,shotListId:String)=draft
    override suspend fun loadProject(storeId:String,taskId:String,shotListId:String,projectId:String)=draft
    override suspend fun saveProject(storeId:String,taskId:String,shotListId:String,draft:StoryboardDraft,finalize:Boolean):StoryboardDraft { finalizeCalls += finalize; this.draft=draft.copy(version=draft.version+1,status=if(finalize) "final" else "draft"); return this.draft }
    override suspend fun createRender(storeId:String,taskId:String,shotListId:String,projectId:String,kind:String):StoryboardRender { renderCalls += kind; return StoryboardRender(kind,kind,RenderState.Queued) }
    override suspend fun listRenders(storeId:String,taskId:String,shotListId:String,projectId:String)=emptyList<StoryboardRender>()
    override suspend fun cancelRender(storeId:String,taskId:String,shotListId:String,projectId:String,renderId:String)=StoryboardRender(renderId,"preview",RenderState.Cancelled)
    override suspend fun deleteRender(storeId:String,taskId:String,shotListId:String,projectId:String,renderId:String) {}
    override suspend fun selectCover(storeId:String,taskId:String,shotListId:String,projectId:String,renderId:String,candidateId:String,title:String)=CoverSelection(candidateId,title)
}
