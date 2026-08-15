package com.restaurantops.content

import com.google.gson.Gson
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType
import okhttp3.ResponseBody
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

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

    @Test fun retrofitContractCoversEveryCustomerContentEndpoint() = runBlocking {
        MockWebServer().use { server ->
            listOf(
                "{\"tasks\":[{\"id\":\"task-1\",\"status\":\"topic_draft\",\"confirmedCopyId\":null,\"createdAt\":\"2026-08-15T00:00:00.000Z\"}]}",
                detailJson(),
                "{\"id\":\"task-2\",\"profileVersion\":2,\"primaryGoal\":\"increase visits\",\"status\":\"topic_draft\"}",
                "[${topicJson("topic-1")}]",
                "[${copyJson("copy-1", "strategy-one")},${copyJson("copy-2", "strategy-two")},${copyJson("copy-3", "strategy-three")} ]",
                copyJson("copy-1", "strategy-one"),
                copyJson("copy-1", "strategy-one"),
                shotListJson()
            ).forEach { body -> server.enqueue(MockResponse().setResponseCode(200).setBody(body)) }
            val repository = HttpContentCreationRepository(realWireApi(server))

            assertEquals("task-1", repository.listTasks("store-1").single().id)
            assertNull(repository.loadTask("store-1", "task-1").shotList)
            assertEquals(2, repository.createTask("store-1", CreateContentTaskRequest("owner", "short_video", "warm", 1, "fresh idea")).profileVersion)
            assertEquals("topic-1", repository.generateTopics("store-1", "task-1").single().id)
            assertEquals(3, repository.generateCopies("store-1", "task-1", "topic-1").size)
            assertEquals("copy-1", repository.updateCopy("store-1", "task-1", "copy-1", UpdateContentCopyRequest("Edited", "Edited body")).id)
            assertTrue(repository.confirmCopy("store-1", "task-1", "copy-1") is CopyConfirmationResult.Confirmed)
            assertEquals(3, repository.generateShots("store-1", "task-1").shots.size)

            assertRequest(server, "GET", "/v1/stores/store-1/content-tasks")
            assertRequest(server, "GET", "/v1/stores/store-1/content-tasks/task-1")
            assertRequest(server, "POST", "/v1/stores/store-1/content-tasks", "\"persona\":\"owner\"", "\"contentType\":\"short_video\"", "\"style\":\"warm\"", "\"commercialLevel\":1", "\"inspiration\":\"fresh idea\"")
            assertRequest(server, "POST", "/v1/stores/store-1/content-tasks/task-1/topics/generate")
            assertRequest(server, "POST", "/v1/stores/store-1/content-tasks/task-1/topics/topic-1/copies/generate")
            assertRequest(server, "PUT", "/v1/stores/store-1/content-tasks/task-1/copies/copy-1", "\"title\":\"Edited\"", "\"body\":\"Edited body\"")
            assertRequest(server, "POST", "/v1/stores/store-1/content-tasks/task-1/copies/copy-1/confirm")
            assertRequest(server, "POST", "/v1/stores/store-1/content-tasks/task-1/shots/generate")
        }
    }

    @Test fun invalidLocalContentInputsRejectBeforeNetwork() = runBlocking {
        MockWebServer().use { server ->
            val repository = HttpContentCreationRepository(realWireApi(server))

            assertContentError { repository.listTasks(" ") }
            assertContentError { repository.loadTask("store-1", " ") }
            assertContentError { repository.createTask("store-1", CreateContentTaskRequest("", "short_video", "warm", 1)) }
            assertContentError { repository.createTask("store-1", CreateContentTaskRequest("owner", "short_video", "warm", 4)) }
            assertContentError { repository.updateCopy("store-1", "task-1", "copy-1", UpdateContentCopyRequest("", "Body")) }

            assertEquals(0, server.requestCount)
        }
    }

    @Test fun malformedTaskDetailAndMalformed422StayNeutral() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("{\"id\":\"task-1\",\"status\":\"topic_draft\",\"topics\":null,\"copies\":[],\"reviewFindings\":[],\"shotList\":null}"))
            server.enqueue(MockResponse().setResponseCode(422).setBody("{\"findings\":[{\"copyId\":\"copy-1\"}]}"))
            val repository = HttpContentCreationRepository(realWireApi(server))

            assertEquals("Content response is invalid", assertContentError { repository.loadTask("store-1", "task-1") }.message)
            assertEquals("Content response is invalid", assertContentError { repository.confirmCopy("store-1", "task-1", "copy-1") }.message)
        }
    }

    @Test fun non422ServerFailuresMapToNeutralContentError() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(500).setBody("{\"error\":\"private server detail\"}"))

            val error = assertContentError { HttpContentCreationRepository(realWireApi(server)).listTasks("store-1") }

            assertEquals(500, error.statusCode)
            assertEquals("Unable to complete the content request", error.message)
        }
    }
}

private fun realWireApi(server: MockWebServer): ContentCreationWireApi = Retrofit.Builder()
    .baseUrl(server.url("/"))
    .addConverterFactory(GsonConverterFactory.create())
    .build()
    .create(ContentCreationWireApi::class.java)

private fun assertRequest(server: MockWebServer, method: String, path: String, vararg bodyParts: String) {
    val request = server.takeRequest()
    assertEquals(method, request.method)
    assertEquals(path, request.path)
    val body = request.body.readUtf8()
    bodyParts.forEach { expected -> assertTrue("Missing $expected in $body", body.contains(expected)) }
}

private suspend fun assertContentError(block: suspend () -> Unit): ContentCreationRequestException = try {
    block()
    error("Expected content request failure")
} catch (error: ContentCreationRequestException) {
    error
}

private fun topicJson(id: String) = "{\"id\":\"$id\",\"title\":\"Dinner feature\",\"angle\":\"fresh\",\"productReference\":\"noodles\",\"goalReference\":\"visits\",\"commercialLevel\":1}"
private fun copyJson(id: String, strategy: String) = "{\"id\":\"$id\",\"topicId\":\"topic-1\",\"title\":\"Dinner feature\",\"body\":\"Try tonight\",\"strategy\":\"$strategy\",\"productReference\":\"noodles\",\"goalReference\":\"visits\",\"commercialLevel\":1,\"version\":1,\"status\":\"draft\"}"
private fun detailJson() = "{\"id\":\"task-1\",\"status\":\"copy_draft\",\"topics\":[${topicJson("topic-1")}],\"copies\":[${copyJson("copy-1", "strategy-one")}],\"reviewFindings\":[],\"shotList\":null}"
private fun shotListJson() = "{\"id\":\"shots-1\",\"copyId\":\"copy-1\",\"status\":\"draft\",\"shots\":[{\"order\":1,\"shot\":\"open\",\"durationSeconds\":3,\"narration\":\"start\",\"productReference\":\"noodles\",\"goalReference\":\"visits\",\"commercialLevel\":1},{\"order\":2,\"shot\":\"serve\",\"durationSeconds\":3,\"narration\":\"middle\",\"productReference\":\"noodles\",\"goalReference\":\"visits\",\"commercialLevel\":1},{\"order\":3,\"shot\":\"close\",\"durationSeconds\":3,\"narration\":\"end\",\"productReference\":\"noodles\",\"goalReference\":\"visits\",\"commercialLevel\":1}]}"

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
