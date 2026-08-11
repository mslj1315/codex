package com.restaurantops.imports.network

import com.restaurantops.imports.ImportCandidate
import com.restaurantops.imports.ImportCandidateStatus
import com.restaurantops.imports.ImportCandidateUpdate
import com.restaurantops.imports.ImportBatchStatus
import com.restaurantops.imports.ImportSourceType
import com.restaurantops.imports.ManualImportDraft
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

class HttpImportRepositoryTest {
    @Test
    fun `manual import maps candidates without sending client identity`() = runBlocking {
        val api = FakeImportApi().apply {
            manualResponse = batchResponse(
                candidates = listOf(candidateResponse(value = 9_007_199_254_740_991L, status = "ready"))
            )
        }
        val repository = HttpImportRepository(api)

        val result = repository.createManualImport(
            storeId = "store_demo",
            draft = ManualImportDraft(
                rangeStart = "2026-08-01",
                rangeEnd = "2026-08-07",
                candidates = listOf(domainCandidate(value = 9_007_199_254_740_991L))
            )
        )

        assertEquals(ImportSourceType.MANUAL, result.sourceType)
        assertEquals(9_007_199_254_740_991L, result.candidates.single().value)
        assertEquals(ImportCandidateStatus.READY, result.candidates.single().status)
        assertEquals(setOf("rangeStart", "rangeEnd", "candidates"), api.manualRequest!!.fieldNames())
        assertEquals("revenue", api.manualRequest!!.candidates.single().metricKey)
    }

    @Test
    fun `manual monetary values in yuan are sent as whole cents`() = runBlocking {
        val api = FakeImportApi()
        val repository = HttpImportRepository(api)

        repository.createManualImport(
            storeId = "store_demo",
            draft = ManualImportDraft(
                rangeStart = "2026-08-01",
                rangeEnd = "2026-08-07",
                candidates = listOf(
                    domainCandidate(metricKey = "revenue", value = 48_260L, unit = "yuan"),
                    domainCandidate(metricKey = "average_spend", value = 38L, unit = "yuan")
                )
            )
        )

        assertEquals(4_826_000L, api.manualRequest!!.candidates[0].value)
        assertEquals("cents", api.manualRequest!!.candidates[0].unit)
        assertEquals(3_800L, api.manualRequest!!.candidates[1].value)
        assertEquals("cents", api.manualRequest!!.candidates[1].unit)
    }

    @Test
    fun `batch mapping retains nullable fields and terminal candidate statuses`() = runBlocking {
        val api = FakeImportApi().apply {
            loadedResponse = batchResponse(
                candidates = listOf(
                    candidateResponse(status = "confirmed", issueCode = null, rangeStart = null, rangeEnd = null),
                    candidateResponse(id = "rejected", status = "rejected", issueCode = "invalid_value")
                )
            )
        }
        val repository = HttpImportRepository(api)

        val result = repository.loadImport("store_demo", "batch_1")

        assertEquals(ImportCandidateStatus.CONFIRMED, result.candidates[0].status)
        assertNull(result.candidates[0].issueCode)
        assertNull(result.candidates[0].rangeStart)
        assertNull(result.candidates[0].rangeEnd)
        assertEquals(ImportCandidateStatus.REJECTED, result.candidates[1].status)
        assertEquals("invalid_value", result.candidates[1].issueCode)
        assertEquals(ImportBatchStatus.PENDING_CONFIRMATION, result.status)
    }

    @Test
    fun `candidate update merges endpoint response into cached import summary`() = runBlocking {
        val api = FakeImportApi().apply {
            loadedResponse = batchResponse(candidates = listOf(candidateResponse(), candidateResponse(id = "other")))
            updatedCandidate = candidateResponse(value = 42L, status = "ready")
        }
        val repository = HttpImportRepository(api)
        repository.loadImport("store_demo", "batch_1")

        val result = repository.updateCandidate(
            storeId = "store_demo",
            importId = "batch_1",
            candidateId = "candidate_1",
            update = ImportCandidateUpdate(value = 42L, unit = "cents", status = ImportCandidateStatus.READY)
        )

        assertEquals(42L, result.candidates.first { it.id == "candidate_1" }.value)
        assertEquals(2, result.candidates.size)
        assertEquals(ImportCandidateStatus.NEEDS_CONFIRMATION, result.candidates.first { it.id == "other" }.status)
        assertEquals("ready", api.updateRequest!!.status)
    }

    @Test
    fun `monetary candidate edits in yuan are patched as cents`() = runBlocking {
        val api = FakeImportApi().apply {
            loadedResponse = batchResponse(candidates = listOf(
                candidateResponse(metricKey = "average_spend", value = 38L, unit = "unknown")
            ))
            updatedCandidate = candidateResponse(metricKey = "average_spend", value = 3_800L, unit = "cents", status = "ready")
        }
        val repository = HttpImportRepository(api)
        repository.loadImport("store_demo", "batch_1")

        repository.updateCandidate(
            storeId = "store_demo",
            importId = "batch_1",
            candidateId = "candidate_1",
            update = ImportCandidateUpdate(value = 38L, unit = "yuan", status = ImportCandidateStatus.READY)
        )

        assertEquals(3_800L, api.updateRequest!!.value)
        assertEquals("cents", api.updateRequest!!.unit)
    }

    @Test
    fun `overflowing yuan input is rejected before any manual API call`() = runBlocking {
        val api = FakeImportApi()
        val repository = HttpImportRepository(api)

        val error = try {
            repository.createManualImport(
                "store_demo",
                ManualImportDraft(
                    "2026-08-01",
                    "2026-08-07",
                    listOf(domainCandidate(value = Long.MAX_VALUE / 100 + 1, unit = "yuan"))
                )
            )
            error("Expected ImportRequestException")
        } catch (expected: ImportRequestException) {
            expected
        }

        assertEquals(422, error.statusCode)
        assertNull(api.manualRequest)
    }

    @Test
    fun `confirm sends exactly supplied candidate ids and maps fact version`() = runBlocking {
        val api = FakeImportApi().apply {
            factResponse = FactVersionResponse(
                id = "fact_1",
                sourceBatchId = "batch_1",
                confirmationStatus = "confirmed",
                values = emptyList()
            )
        }
        val repository = HttpImportRepository(api)

        val result = repository.confirm("store_demo", "batch_1", listOf("ready_1", "ready_2"))

        assertEquals(listOf("ready_1", "ready_2"), api.confirmRequest!!.candidateIds)
        assertEquals("fact_1", result.id)
        assertEquals("batch_1", result.sourceImportId)
        assertEquals("confirmed", result.status)
    }

    @Test
    fun `HTTP response failures become typed import request exceptions`() = runBlocking {
        val api = FakeImportApi().apply {
            manualFailure = HttpException(
                Response.error<ImportBatchResponse>(
                    422,
                    okhttp3.ResponseBody.create(null, "{\"error\":\"Candidate unit does not match metric\"}")
                )
            )
        }
        val repository = HttpImportRepository(api)

        val error = try {
            repository.createManualImport("store_demo", ManualImportDraft("2026-08-01", "2026-08-07", listOf(domainCandidate())))
            error("Expected ImportRequestException")
        } catch (expected: ImportRequestException) {
            expected
        }

        assertEquals(422, error.statusCode)
        assertEquals("Candidate unit does not match metric", error.message)
    }

    @Test
    fun `HTTP error parsing closes the response body when JSON is valid or malformed`() = runBlocking {
        val validBody = TrackingResponseBody("{\"error\":\"Invalid range\"}")
        val malformedBody = TrackingResponseBody("not json")
        assertImportFailure(validBody)
        assertImportFailure(malformedBody)

        assertTrue(validBody.closed)
        assertTrue(malformedBody.closed)
    }

    @Test
    fun `import API declares the local service contract without client identity fields`() {
        val api = ImportApi::class.java

        assertEndpoint(
            api.method("createManualImport"),
            POST::class.java,
            "/v1/stores/{storeId}/imports/manual"
        )
        assertEndpoint(
            api.method("loadImport"),
            GET::class.java,
            "/v1/stores/{storeId}/imports/{batchId}"
        )
        assertEndpoint(
            api.method("updateCandidate"),
            PATCH::class.java,
            "/v1/stores/{storeId}/imports/{batchId}/candidates/{candidateId}"
        )
        assertEndpoint(
            api.method("confirm"),
            POST::class.java,
            "/v1/stores/{storeId}/imports/{batchId}/confirm"
        )
        assertEndpoint(
            api.method("latestFacts"),
            GET::class.java,
            "/v1/stores/{storeId}/facts/latest"
        )

        assertEquals(setOf("rangeStart", "rangeEnd", "candidates"), ManualImportRequest::class.java.instanceFieldNames())
        assertEquals(setOf("candidateIds"), ConfirmImportRequest::class.java.instanceFieldNames())
        val create = api.method("createManualImport")
        assertNotNull(create.getAnnotation(POST::class.java))
        assertNotNull(create.parameterAnnotations[1].filterIsInstance<Body>().singleOrNull())
        assertEquals(1, create.parameterAnnotations[0].filterIsInstance<Path>().size)
    }

    private fun assertEndpoint(method: java.lang.reflect.Method, annotation: Class<out Annotation>, expectedPath: String) {
        val endpoint = method.getAnnotation(annotation)
        assertNotNull("${method.name} needs ${annotation.simpleName}", endpoint)
        val value = annotation.getMethod("value").invoke(endpoint) as String
        assertEquals(expectedPath, value)
    }

    private fun Class<ImportApi>.method(name: String): java.lang.reflect.Method =
        methods.single { it.name == name }

    private fun Class<*>.instanceFieldNames(): Set<String> =
        declaredFields.filterNot { java.lang.reflect.Modifier.isStatic(it.modifiers) }.map { it.name }.toSet()

    private fun Any.fieldNames(): Set<String> =
        javaClass.declaredFields.filterNot { java.lang.reflect.Modifier.isStatic(it.modifiers) }.map { it.name }.toSet()

    private suspend fun assertImportFailure(body: okhttp3.ResponseBody) {
        val api = FakeImportApi().apply {
            manualFailure = HttpException(Response.error<ImportBatchResponse>(422, body))
        }
        val failingRepository = HttpImportRepository(api)
        try {
            failingRepository.createManualImport("store_demo", ManualImportDraft("2026-08-01", "2026-08-07", listOf(domainCandidate())))
            error("Expected ImportRequestException")
        } catch (_: ImportRequestException) {
            // Expected.
        }
    }

    private companion object {
    fun domainCandidate(
        metricKey: String = "revenue",
        value: Long = 1L,
        unit: String = "cents"
    ) = ImportCandidate(
        id = "candidate_1", metricKey = metricKey, metricDisplayName = "Revenue", value = value,
        unit = unit, confidence = 100, status = ImportCandidateStatus.READY
    )

    fun batchResponse(candidates: List<ImportCandidateResponse>) = ImportBatchResponse(
        id = "batch_1", sourceType = "manual", status = "pending_confirmation",
        rangeStart = "2026-08-01", rangeEnd = "2026-08-07", candidates = candidates
    )

    private class TrackingResponseBody(private val content: String) : okhttp3.ResponseBody() {
        var closed = false

        override fun contentType(): okhttp3.MediaType? = null

        override fun contentLength(): Long = content.length.toLong()

        override fun source(): okio.BufferedSource = okio.Buffer().writeUtf8(content)

        override fun close() {
            closed = true
            super.close()
        }
    }

    fun candidateResponse(
        id: String = "candidate_1", metricKey: String = "revenue", value: Long = 1L, unit: String = "cents", status: String = "needs_confirmation",
        issueCode: String? = "unit_missing", rangeStart: String? = "2026-08-01", rangeEnd: String? = "2026-08-07"
    ) = ImportCandidateResponse(
        id = id, metricKey = metricKey, metricDisplayName = "Revenue", value = value, unit = unit,
        confidence = 80, status = status, issueCode = issueCode, rangeStart = rangeStart,
        rangeEnd = rangeEnd, sourceLocator = "manual:revenue"
    )

    private class FakeImportApi : ImportApi {
        var manualResponse: ImportBatchResponse = batchResponse(listOf(candidateResponse()))
        var loadedResponse: ImportBatchResponse = batchResponse(listOf(candidateResponse()))
        var updatedCandidate: ImportCandidateResponse = candidateResponse()
        var factResponse: FactVersionResponse = FactVersionResponse("fact_1", "batch_1", "confirmed", emptyList())
        var manualRequest: ManualImportRequest? = null
        var updateRequest: CandidateUpdateRequest? = null
        var confirmRequest: ConfirmImportRequest? = null
        var manualFailure: Throwable? = null

        override suspend fun createManualImport(storeId: String, request: ManualImportRequest): ImportBatchResponse {
            manualRequest = request
            manualFailure?.let { throw it }
            return manualResponse
        }

        override suspend fun loadImport(storeId: String, batchId: String): ImportBatchResponse = loadedResponse

        override suspend fun updateCandidate(storeId: String, batchId: String, candidateId: String, request: CandidateUpdateRequest): ImportCandidateResponse {
            updateRequest = request
            return updatedCandidate
        }

        override suspend fun confirm(storeId: String, batchId: String, request: ConfirmImportRequest): FactVersionResponse {
            confirmRequest = request
            return factResponse
        }

        override suspend fun latestFacts(storeId: String): FactVersionResponse = factResponse
    }
    }
}
