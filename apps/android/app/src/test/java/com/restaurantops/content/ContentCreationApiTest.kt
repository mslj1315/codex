package com.restaurantops.content

import com.google.gson.Gson
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType
import okhttp3.ResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.Response

class ContentCreationApiTest {
    @Test fun parsesAnEmptyTaskEnvelope() {
        val dto = Gson().fromJson("{\"tasks\":[]}", ContentTaskListWireDto::class.java)
        assertEquals(emptyList<ContentTaskSummary>(), contentTaskListFrom(dto))
    }

    @Test fun mapsTaskDetailWithNoShotList() {
        val task = contentTaskDetailFrom(
            ContentTaskDetailWireDto(
                id = "task-1", status = "copy_draft", topics = emptyList(), copies = emptyList(),
                reviewFindings = emptyList(), shotList = null
            )
        )

        assertEquals("task-1", task.id)
        assertNull(task.shotList)
    }

    @Test fun generatedCopiesRequireExactlyThreeDistinctStrategies() {
        val copies = listOf(
            copy("copy-1", "价值亮点"), copy("copy-2", "场景共鸣"), copy("copy-3", "行动引导")
        )

        assertEquals(3, generatedCopiesFrom(copies).size)
        try {
            generatedCopiesFrom(copies.dropLast(1) + copy("copy-3", "价值亮点"))
            error("Expected strategy validation failure")
        } catch (error: ContentCreationRequestException) {
            assertEquals("Generated copy options are invalid", error.message)
        }
    }

    @Test fun confirmationMaps422FindingsToRevisionRequired() = runBlocking {
        val api = FakeContentCreationWireApi().apply {
            confirmation = Response.error(
                422,
                ResponseBody.create(
                    MediaType.parse("application/json"),
                    "{\"findings\":[{\"copyId\":\"copy-1\",\"pattern\":\"unsupported claim\",\"severity\":\"high\",\"guidance\":\"Use verifiable wording\",\"source\":\"semantic\"}]}"
                )
            )
        }

        val result = HttpContentCreationRepository(api).confirmCopy("store-1", "task-1", "copy-1")

        val revision = result as CopyConfirmationResult.RevisionRequired
        assertEquals("Use verifiable wording", revision.findings.single().guidance)
    }
}

private fun copy(id: String, strategy: String) = ContentCopyWireDto(
    id = id, topicId = "topic-1", title = "Title", body = "Body", strategy = strategy,
    productReference = "product", goalReference = "goal", commercialLevel = 1, version = 1, status = "draft"
)

private class FakeContentCreationWireApi : ContentCreationWireApi {
    lateinit var confirmation: Response<ContentCopyWireDto>

    override suspend fun listTasks(storeId: String) = ContentTaskListWireDto(emptyList())
    override suspend fun loadTask(storeId: String, taskId: String) = error("not used")
    override suspend fun createTask(storeId: String, request: CreateContentTaskWireRequest) = error("not used")
    override suspend fun generateTopics(storeId: String, taskId: String) = error("not used")
    override suspend fun generateCopies(storeId: String, taskId: String, topicId: String) = error("not used")
    override suspend fun updateCopy(storeId: String, taskId: String, copyId: String, request: UpdateContentCopyWireRequest) = error("not used")
    override suspend fun confirmCopy(storeId: String, taskId: String, copyId: String) = confirmation
    override suspend fun generateShots(storeId: String, taskId: String) = error("not used")
}
