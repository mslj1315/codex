package com.restaurantops.content

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ContentCreationViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() { Dispatchers.setMain(dispatcher) }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test fun initialLoadShowsEmptyQueue() = runTest(dispatcher) {
        val viewModel = ContentCreationViewModel(FakeContentCreationRepository())

        viewModel.load("store")
        advanceUntilIdle()

        assertTrue(viewModel.state.value.tasks.isEmpty())
        assertEquals(ContentCreationStage.Idle, viewModel.state.value.stage)
        assertTrue(viewModel.state.value.loaded)
    }

    @Test fun createTaskRestoresItsDetailFromServer() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository()
        val viewModel = ContentCreationViewModel(repository)

        viewModel.create("store", request())
        advanceUntilIdle()

        assertEquals("task", viewModel.state.value.task?.id)
        assertEquals(1, repository.createCalls)
        assertEquals(1, repository.loadCalls)
    }

    @Test fun restoredTopicsWithoutCopiesForcesTopicSelectionWithoutPersistingChoice() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = emptyList()))
        val viewModel = ContentCreationViewModel(repository)

        viewModel.restore("store", "task")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.TopicSelection, viewModel.state.value.stage)
        assertNull(viewModel.state.value.selectedTopicId)
        assertFalse(viewModel.state.value.canGenerateCopies)
    }

    @Test fun restoredValidCopiesSelectTheirActualTopicForEditing() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = copies(topicId = "topic-2")))
        val viewModel = ContentCreationViewModel(repository)

        viewModel.restore("store", "task")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.CopyEditing, viewModel.state.value.stage)
        assertEquals("topic-2", viewModel.state.value.selectedTopicId)
        assertEquals("copy-1", viewModel.state.value.selectedCopyId)
        assertTrue(viewModel.state.value.canSelectCopy)
    }

    @Test fun topicSelectionGeneratesCopiesThenSavesEditedDraft() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = emptyList()))
        val viewModel = ContentCreationViewModel(repository)
        viewModel.restore("store", "task")
        advanceUntilIdle()

        viewModel.selectTopic("topic-2")
        viewModel.generateCopies("store")
        advanceUntilIdle()
        viewModel.updateSelectedDraft("changed", "changed body")
        viewModel.saveSelectedCopy("store")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.CopyEditing, viewModel.state.value.stage)
        assertEquals("topic-2", viewModel.state.value.selectedTopicId)
        assertEquals("changed", viewModel.state.value.task?.copies?.first { it.id == "copy-1" }?.title)
        assertEquals(1, repository.copyGenerationCalls)
        assertEquals(1, repository.updateCalls)
    }

    @Test fun invalidCopyStrategiesDoNotEnableCopySelection() = runTest(dispatcher) {
        val invalidCopies = copies().map { it.copy(strategy = "same") }
        val repository = FakeContentCreationRepository(detail(copies = invalidCopies))
        val viewModel = ContentCreationViewModel(repository)

        viewModel.restore("store", "task")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.TopicSelection, viewModel.state.value.stage)
        assertFalse(viewModel.state.value.canSelectCopy)
        assertNull(viewModel.state.value.selectedCopyId)
    }

    @Test fun revisionRequiredKeepsDraftAndBlocksConfirmationAndShots() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = copies())).apply {
            confirmation = CopyConfirmationResult.RevisionRequired(listOf(finding()))
        }
        val viewModel = ContentCreationViewModel(repository)
        viewModel.restore("store", "task")
        advanceUntilIdle()

        viewModel.confirmSelectedCopy("store")
        advanceUntilIdle()
        viewModel.confirmSelectedCopy("store")
        viewModel.generateShots("store")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.RevisionRequired, viewModel.state.value.stage)
        assertEquals("copy-1", viewModel.state.value.selectedCopyId)
        assertEquals(listOf(finding()), viewModel.state.value.reviewFindings)
        assertEquals(1, repository.confirmCalls)
        assertEquals(0, repository.shotCalls)
        assertEquals(2, repository.loadCalls)
    }

    @Test fun confirmedCopyAllowsShotGenerationAndRestoresStoryboardHandoff() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = copies()))
        val viewModel = ContentCreationViewModel(repository)
        viewModel.restore("store", "task")
        advanceUntilIdle()

        viewModel.confirmSelectedCopy("store")
        advanceUntilIdle()
        viewModel.generateShots("store")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.StoryboardReady, viewModel.state.value.stage)
        assertEquals("shots", viewModel.state.value.shotList?.id)
        assertEquals(1, repository.shotCalls)
    }

    @Test fun inFlightGuardPreventsDuplicateCreateAndAllowsRetryAfterFailure() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository().apply { createGate = CompletableDeferred() }
        val viewModel = ContentCreationViewModel(repository)

        viewModel.create("store", request())
        viewModel.create("store", request())
        advanceUntilIdle()
        assertEquals(1, repository.createCalls)

        repository.createGate!!.completeExceptionally(IllegalStateException("raw failure"))
        advanceUntilIdle()
        assertFalse(viewModel.state.value.finalizing)
        assertEquals("暂时无法完成内容操作", viewModel.state.value.error)

        viewModel.create("store", request())
        advanceUntilIdle()
        assertEquals(2, repository.createCalls)
    }

    private fun request() = CreateContentTaskRequest("persona", "video", "style", 1)

    private fun detail(copies: List<ContentCopy>) = ContentTaskDetail(
        id = "task", status = "draft", topics = listOf(topic("topic-1"), topic("topic-2")),
        copies = copies, reviewFindings = emptyList(), shotList = null
    )

    private fun topic(id: String) = ContentTopic(id, "title", "angle", "product", "goal", 1)

    private fun copies(topicId: String = "topic-1") = listOf(
        ContentCopy("copy-1", topicId, "one", "body one", "story", "product", "goal", 1, 1, "draft"),
        ContentCopy("copy-2", topicId, "two", "body two", "proof", "product", "goal", 1, 1, "draft"),
        ContentCopy("copy-3", topicId, "three", "body three", "offer", "product", "goal", 1, 1, "draft")
    )

    private fun finding() = ContentReviewFinding("copy-1", "rule", "warning", "revise", "semantic")
}

private class FakeContentCreationRepository(
    private var currentDetail: ContentTaskDetail = ContentTaskDetail("task", "draft", emptyList(), emptyList(), emptyList(), null)
) : ContentCreationApi {
    var createCalls = 0
    var loadCalls = 0
    var confirmCalls = 0
    var shotCalls = 0
    var copyGenerationCalls = 0
    var updateCalls = 0
    var createGate: CompletableDeferred<CreatedContentTask>? = null
    var confirmation: CopyConfirmationResult = CopyConfirmationResult.Confirmed(
        ContentCopy("copy-1", "topic-1", "one", "body one", "story", "product", "goal", 1, 1, "confirmed")
    )

    override suspend fun listTasks(storeId: String) = emptyList<ContentTaskSummary>()
    override suspend fun loadTask(storeId: String, taskId: String): ContentTaskDetail { loadCalls++; return currentDetail }
    override suspend fun createTask(storeId: String, request: CreateContentTaskRequest): CreatedContentTask {
        createCalls++
        return createGate?.await() ?: CreatedContentTask("task", 1, "goal", "draft")
    }
    override suspend fun generateTopics(storeId: String, taskId: String) = currentDetail.topics
    override suspend fun generateCopies(storeId: String, taskId: String, topicId: String): List<ContentCopy> {
        copyGenerationCalls++
        return copiesFor(topicId).also { generated -> currentDetail = currentDetail.copy(copies = generated) }
    }
    override suspend fun updateCopy(storeId: String, taskId: String, copyId: String, request: UpdateContentCopyRequest): ContentCopy {
        updateCalls++
        val copy = currentDetail.copies.first { it.id == copyId }.copy(title = request.title, body = request.body)
        currentDetail = currentDetail.copy(copies = currentDetail.copies.map { existing -> if (existing.id == copyId) copy else existing })
        return copy
    }
    override suspend fun confirmCopy(storeId: String, taskId: String, copyId: String): CopyConfirmationResult {
        confirmCalls++
        if (confirmation is CopyConfirmationResult.Confirmed) {
            currentDetail = currentDetail.copy(copies = currentDetail.copies.map { copy ->
                if (copy.id == copyId) copy.copy(status = "confirmed") else copy
            })
        }
        return confirmation
    }
    override suspend fun generateShots(storeId: String, taskId: String): ContentShotList {
        shotCalls++
        return ContentShotList("shots", "copy-1", "generated", emptyList()).also { shotList ->
            currentDetail = currentDetail.copy(shotList = shotList)
        }
    }

    private fun copiesFor(topicId: String) = listOf(
        ContentCopy("copy-1", topicId, "one", "body one", "story", "product", "goal", 1, 1, "draft"),
        ContentCopy("copy-2", topicId, "two", "body two", "proof", "product", "goal", 1, 1, "draft"),
        ContentCopy("copy-3", topicId, "three", "body three", "offer", "product", "goal", 1, 1, "draft")
    )
}
