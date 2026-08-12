package com.restaurantops.operations

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test
import retrofit2.http.GET
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class HttpOperationsRepositoryTest {
    @Test
    fun `maps readiness diagnostic and action card responses without source identifiers`() = runBlocking {
        val api = FakeOperationsApi()
        val repository = HttpOperationsRepository(api)

        val readiness = repository.loadReadiness("store_demo", "2026-08-01", "2026-08-07")
        val diagnostic = repository.loadDeterministicDiagnostic("store_demo", "2026-08-01", "2026-08-07")
        val cards = repository.loadActionCards("store_demo", "in_progress")

        assertEquals(OperationsConfidence.MEDIUM, readiness.confidence)
        assertEquals(listOf("average_spend"), readiness.missingMetrics)
        assertEquals("revenue_decline", diagnostic!!.kind)
        assertEquals("action_1", cards.single().id)
        assertEquals("in_progress", api.status)
    }

    @Test
    fun `maps absent diagnostic and verification summary to null`() = runBlocking {
        val api = FakeOperationsApi().apply { diagnostic = null; verificationSummary = null }
        val repository = HttpOperationsRepository(api)

        assertNull(repository.loadDeterministicDiagnostic("store_demo", "2026-08-01", "2026-08-07"))
        assertNull(repository.loadVerificationSummary("store_demo", "action_1"))
    }

    @Test
    fun `operations API uses server paths and does not expose raw import fields`() {
        val api = OperationsApi::class.java
        assertEquals("/v1/stores/{storeId}/readiness", requireNotNull(api.methods.single { it.name == "readiness" }.getAnnotation(GET::class.java)).value)
        assertEquals("/v1/stores/{storeId}/diagnostics/deterministic", requireNotNull(api.methods.single { it.name == "deterministicDiagnostic" }.getAnnotation(GET::class.java)).value)
        assertEquals("/v1/stores/{storeId}/action-cards", requireNotNull(api.methods.single { it.name == "actionCards" }.getAnnotation(GET::class.java)).value)
        assertEquals("/v1/stores/{storeId}/action-cards/{actionCardId}/verification-summary", requireNotNull(api.methods.single { it.name == "verificationSummary" }.getAnnotation(GET::class.java)).value)
        assertNull(ActionCardResponse::class.java.declaredFields.singleOrNull { it.name == "objectKey" })
        assertNull(ActionCardResponse::class.java.declaredFields.singleOrNull { it.name == "batchId" })
    }

    @Test
    fun `maps HTTP and network failures to typed operations errors`() = runBlocking {
        val httpApi = FakeOperationsApi().apply { readinessFailure = HttpException(Response.error<DataReadinessResponse>(422, okhttp3.ResponseBody.create(null, "{\"error\":\"private detail\"}"))) }
        val networkApi = FakeOperationsApi().apply { readinessFailure = IOException("private host") }

        val httpError = try { HttpOperationsRepository(httpApi).loadReadiness("store_demo", "2026-08-01", "2026-08-07"); error("Expected request failure") } catch (error: OperationsRequestException) { error }
        val networkError = try { HttpOperationsRepository(networkApi).loadReadiness("store_demo", "2026-08-01", "2026-08-07"); error("Expected request failure") } catch (error: OperationsRequestException) { error }

        assertEquals(422, httpError.statusCode)
        assertEquals("Unable to load operations data", httpError.message)
        assertEquals(0, networkError.statusCode)
        assertEquals("Unable to reach the operations service", networkError.message)
    }
}

private class FakeOperationsApi : OperationsApi {
    var status: String? = null
    var diagnostic: DeterministicDiagnosticResponse? = DeterministicDiagnosticResponse("revenue_decline", "2026-08-01", "2026-08-07", "2026-07-25", "2026-07-31", DiagnosticFactResponse("revenue", 3826000, 4400000, -13.05), "high")
    var verificationSummary: ActionCardVerificationSummaryResponse? = null
    var readinessFailure: Throwable? = null

    override suspend fun readiness(storeId: String, rangeStart: String, rangeEnd: String): DataReadinessResponse {
        readinessFailure?.let { throw it }
        return DataReadinessResponse("2026-08-01", "2026-08-07", listOf("revenue", "orders", "average_spend"), listOf("orders", "revenue"), listOf("average_spend"), "medium", true)
    }
    override suspend fun deterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String) = diagnostic
    override suspend fun actionCards(storeId: String, status: String?): List<ActionCardResponse> {
        this.status = status
        return listOf(ActionCardResponse("action_1", "revenue_decline", "2026-08-01", "2026-08-07", "检查午市套餐", "检查订单量", "下一周期营业额与订单数", "in_progress", null, null, null))
    }
    override suspend fun verificationSummary(storeId: String, actionCardId: String) = verificationSummary
}
