package com.restaurantops.content

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CancellationException
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

    @Test fun creationSheetOwnsSafeInputAndAtomicCreateGeneratesThreeTopics() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository().apply { generatedTopics = listOf(topic("topic-1"), topic("topic-2"), topic("topic-3")) }
        val viewModel = ContentCreationViewModel(repository)

        viewModel.openCreationSheet()
        viewModel.updateCreationInput(ContentCreationInput("persona", "video", "style", 1, "idea"))
        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()

        assertFalse(viewModel.state.value.creationSheetOpen)
        assertEquals("task", viewModel.state.value.task?.id)
        assertEquals(1, repository.createCalls)
        assertEquals(1, repository.topicGenerationCalls)
        assertEquals(1, repository.listCalls)
        assertEquals(1, repository.loadCalls)
        assertEquals(ContentCreationStage.TopicSelection, viewModel.state.value.stage)
    }

    @Test fun atomicCreateFailureIsNeutralAllowsRetryAndDoesNotDuplicateInFlightCalls() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository().apply { createGate = CompletableDeferred() }
        val viewModel = ContentCreationViewModel(repository)
        viewModel.openCreationSheet()
        viewModel.updateCreationInput(ContentCreationInput("persona", "video", "style", 1))

        viewModel.createAndGenerateTopics("store")
        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()
        assertEquals(1, repository.createCalls)

        repository.createGate!!.completeExceptionally(IllegalStateException("raw failure"))
        advanceUntilIdle()
        assertEquals("暂时无法完成内容操作", viewModel.state.value.error)
        assertFalse(viewModel.state.value.finalizing)

        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()
        assertEquals(2, repository.createCalls)
    }

    @Test fun topicRetryUsesTheCreatedTaskWithoutCreatingAnotherTask() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(
            ContentTaskDetail("created-task", "draft", emptyList(), emptyList(), emptyList(), null)
        ).apply {
            createdTaskId = "created-task"
            topicFailures += IllegalStateException("first topic failure")
            generatedTopics = listOf(topic("topic-1"), topic("topic-2"), topic("topic-3"))
        }
        val viewModel = ContentCreationViewModel(repository)
        viewModel.openCreationSheet()
        viewModel.updateCreationInput(ContentCreationInput("persona", "video", "style", 1))

        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()
        assertEquals("created-task", viewModel.state.value.pendingTopicGenerationTaskId)
        assertEquals("created-task", viewModel.state.value.task?.id)
        assertEquals(1, repository.createCalls)
        assertEquals(listOf("created-task"), repository.generatedTopicTaskIds)

        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()

        assertEquals(1, repository.createCalls)
        assertEquals(listOf("created-task", "created-task"), repository.generatedTopicTaskIds)
        assertNull(viewModel.state.value.pendingTopicGenerationTaskId)
        assertEquals(3, viewModel.state.value.task?.topics?.size)
        assertEquals(ContentCreationStage.TopicSelection, viewModel.state.value.stage)
    }

    @Test fun dismissingCreationSheetExplicitlyDiscardsPendingTopicRetry() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository().apply {
            topicFailures += IllegalStateException("topic failure")
            createdTaskId = "created-task"
        }
        val viewModel = ContentCreationViewModel(repository)
        viewModel.openCreationSheet()
        viewModel.updateCreationInput(ContentCreationInput("persona", "video", "style", 1))
        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()

        viewModel.dismissCreationSheet()

        assertNull(viewModel.state.value.pendingTopicGenerationTaskId)
        assertFalse(viewModel.state.value.creationSheetOpen)
    }

    @Test fun cancellationDuringPendingTopicRecoveryDoesNotWriteAnErrorOrRecoveryState() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository().apply {
            createdTaskId = "created-task"
            topicFailures += IllegalStateException("topic failure")
            listFailure = CancellationException("recovery cancelled")
        }
        val viewModel = ContentCreationViewModel(repository)
        viewModel.openCreationSheet()
        viewModel.updateCreationInput(ContentCreationInput("persona", "video", "style", 1))

        viewModel.createAndGenerateTopics("store")
        advanceUntilIdle()

        assertEquals("created-task", viewModel.state.value.pendingTopicGenerationTaskId)
        assertNull(viewModel.state.value.task)
        assertNull(viewModel.state.value.error)
        assertFalse(viewModel.state.value.finalizing)
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

    @Test fun confirmSavesEditedDraftBeforeReviewAndRetainsItWhenRevisionIsRequired() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = copies())).apply {
            confirmation = CopyConfirmationResult.RevisionRequired(listOf(finding()))
        }
        val viewModel = ContentCreationViewModel(repository)
        viewModel.restore("store", "task")
        advanceUntilIdle()

        viewModel.updateSelectedDraft("edited title", "edited body")
        viewModel.confirmSelectedCopy("store")
        advanceUntilIdle()

        assertEquals(listOf("edited body"), repository.confirmedBodies)
        assertEquals("edited body", viewModel.state.value.task?.copies?.first { it.id == "copy-1" }?.body)
        assertEquals(ContentCreationStage.RevisionRequired, viewModel.state.value.stage)
        viewModel.confirmSelectedCopy("store")
        viewModel.generateShots("store")
        advanceUntilIdle()
        assertEquals(1, repository.confirmCalls)
        assertEquals(0, repository.shotCalls)
    }

    @Test fun confirmedCopyAllowsShotGenerationAndRestoresStoryboardHandoff() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository(detail(copies = copies()))
        val viewModel = ContentCreationViewModel(repository)
        viewModel.restore("store", "task")
        advanceUntilIdle()

        viewModel.confirmSelectedCopy("store")
        advanceUntilIdle()
        assertEquals("confirmed", viewModel.state.value.tasks.single().status)
        viewModel.generateShots("store")
        advanceUntilIdle()

        assertEquals(ContentCreationStage.StoryboardReady, viewModel.state.value.stage)
        assertEquals("shots", viewModel.state.value.shotList?.id)
        assertEquals(ContentStoryboardHandoff("task", "shots"), viewModel.state.value.storyboardHandoff)
        assertEquals(1, repository.shotCalls)
    }

    @Test fun restoredShotListExposesOnlyServerSuppliedStoryboardHandoff() = runTest(dispatcher) {
        val shotList = ContentShotList("restored-shots", "copy-1", "generated", emptyList())
        val repository = FakeContentCreationRepository(detail(copies = copies()).copy(shotList = shotList))
        val viewModel = ContentCreationViewModel(repository)

        viewModel.restore("store", "task")
        advanceUntilIdle()

        assertEquals(ContentStoryboardHandoff("task", "restored-shots"), viewModel.state.value.storyboardHandoff)
    }

    @Test fun cancellationReleasesFinalizingWithoutAUserVisibleError() = runTest(dispatcher) {
        val repository = FakeContentCreationRepository().apply { listFailure = CancellationException("cancel") }
        val viewModel = ContentCreationViewModel(repository)

        viewModel.load("store")
        advanceUntilIdle()

        assertFalse(viewModel.state.value.finalizing)
        assertNull(viewModel.state.value.error)
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
    var topicGenerationCalls = 0
    var listCalls = 0
    var generatedTopics = emptyList<ContentTopic>()
    var createdTaskId = "task"
    val topicFailures = ArrayDeque<Throwable>()
    val generatedTopicTaskIds = mutableListOf<String>()
    var listFailure: Throwable? = null
    val confirmedBodies = mutableListOf<String>()
    var createGate: CompletableDeferred<CreatedContentTask>? = null
    var confirmation: CopyConfirmationResult = CopyConfirmationResult.Confirmed(
        ContentCopy("copy-1", "topic-1", "one", "body one", "story", "product", "goal", 1, 1, "confirmed")
    )

    override suspend fun listTasks(storeId: String): List<ContentTaskSummary> {
        listCalls++
        listFailure?.let { throw it }
        if (currentDetail.topics.isEmpty() && currentDetail.copies.isEmpty()) return emptyList()
        return listOf(ContentTaskSummary("task", currentDetail.copies.firstOrNull { it.status == "confirmed" }?.let { "confirmed" } ?: "draft", currentDetail.copies.firstOrNull { it.status == "confirmed" }?.id, "now"))
    }
    override suspend fun loadTask(storeId: String, taskId: String): ContentTaskDetail { loadCalls++; return currentDetail }
    override suspend fun createTask(storeId: String, request: CreateContentTaskRequest): CreatedContentTask {
        createCalls++
        return createGate?.await() ?: CreatedContentTask(createdTaskId, 1, "goal", "draft")
    }
    override suspend fun generateTopics(storeId: String, taskId: String): List<ContentTopic> {
        topicGenerationCalls++
        generatedTopicTaskIds += taskId
        if (topicFailures.isNotEmpty()) throw topicFailures.removeFirst()
        return generatedTopics.also { topics -> currentDetail = currentDetail.copy(topics = topics) }
    }
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
        confirmedBodies += currentDetail.copies.first { it.id == copyId }.body
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
