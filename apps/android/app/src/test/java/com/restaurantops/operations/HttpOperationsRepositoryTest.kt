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
    fun `formats action verification metric keys for display`() {
        assertNull(verificationMetricKeysText(emptyList()))
        assertEquals("验证指标：revenue、orders", verificationMetricKeysText(listOf("revenue", "orders")))
    }

    @Test
    fun `formats verification summary values with catalog presentation`() {
        val revenue = VerificationMetric("revenue", 4_826_050, 4_900_000, 1.53)
        val ratio = VerificationMetric("conversion", 1_250, 1_000, -20.0)
        val presentations = mapOf(
            "revenue" to VerificationMetricPresentation("营业额", "cents"),
            "conversion" to VerificationMetricPresentation("转化率", "basis_points")
        )

        assertEquals("营业额：基线 48260.50 元，对比 49000 元，变化 1.53%", formatVerificationMetric(revenue, presentations))
        assertEquals("转化率：基线 12.50%，对比 10%，变化 -20.0%", formatVerificationMetric(ratio, presentations))
        assertEquals("orders：基线 12，对比 15，变化 25.0%", formatVerificationMetric(VerificationMetric("orders", 12, 15, 25.0), presentations))
    }

    @Test
    fun `maps readiness diagnostic and action card responses without source identifiers`() = runBlocking {
        val api = FakeOperationsApi()
        val repository = HttpOperationsRepository(api)

        val readiness = repository.loadReadiness("store_demo", "2026-08-01", "2026-08-07")
        val diagnostic = repository.loadDeterministicDiagnostic("store_demo", "2026-08-01", "2026-08-07")
        val cards = repository.loadActionCards("store_demo", "in_progress")
        val detail = repository.loadDiagnosticRun("store_demo", "diagnostic_run_1")

        assertEquals(OperationsConfidence.MEDIUM, readiness.confidence)
        assertEquals(listOf("average_spend"), readiness.missingMetrics)
        assertEquals("revenue_decline", diagnostic!!.kind)
        assertEquals("diagnostic_run_1", diagnostic.diagnosticRunId)
        assertEquals("revenue_decline_v1", diagnostic.ruleVersion)
        assertEquals(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05), diagnostic.evidence.single())
        assertEquals("action_1", cards.single().id)
        assertEquals(listOf("revenue", "orders"), cards.single().verificationMetricKeys)
        assertEquals("revenue_decline_v1", detail.ruleVersion)
        assertEquals(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05), detail.evidence.single())
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
        assertNull(DeterministicDiagnosticResponse::class.java.declaredFields.singleOrNull { it.name == "factVersionId" })
        assertNull(DeterministicDiagnosticResponse::class.java.declaredFields.singleOrNull { it.name == "sourceBatchId" })
        assertNull(DeterministicDiagnosticResponse::class.java.declaredFields.singleOrNull { it.name == "sourceCandidateId" })
        assertNull(DeterministicDiagnosticResponse::class.java.declaredFields.singleOrNull { it.name == "objectKey" })
        assertEquals("/v1/stores/{storeId}/diagnostic-runs/{diagnosticRunId}", requireNotNull(api.methods.single { it.name == "diagnosticRun" }.getAnnotation(GET::class.java)).value)
        assertNull(DiagnosticRunResponse::class.java.declaredFields.singleOrNull { it.name == "factVersionId" })
        assertNull(DiagnosticRunResponse::class.java.declaredFields.singleOrNull { it.name == "sourceBatchId" })
        assertNull(DiagnosticRunResponse::class.java.declaredFields.singleOrNull { it.name == "sourceCandidateId" })
        assertNull(DiagnosticRunResponse::class.java.declaredFields.singleOrNull { it.name == "objectKey" })
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

    @Test
    fun `completion sends only execution note and maps returned card`() = runBlocking {
        val api = FakeOperationsApi()
        val updated = HttpOperationsRepository(api).updateActionCard(
            "store_demo",
            "action_1",
            ActionCardUpdate.completed("Checked menu placement")
        )

        val request = requireNotNull(api.statusRequest)
        assertEquals("completed", request.status)
        assertEquals("Checked menu placement", request.executionNote)
        assertNull(request.verificationOutcome)
        assertEquals(ActionCardStatus.COMPLETED, updated.status)
        assertEquals("Checked menu placement", updated.executionNote)
    }
}

private class FakeOperationsApi : OperationsApi {
    var status: String? = null
    var diagnostic: DeterministicDiagnosticResponse? = DeterministicDiagnosticResponse("revenue_decline", "2026-08-01", "2026-08-07", "2026-07-25", "2026-07-31", DiagnosticFactResponse("revenue", 3826000, 4400000, -13.05), "high", "diagnostic_run_1", "revenue_decline_v1", listOf(DiagnosticEvidenceResponse("revenue", 3826000, 4400000, -13.05)))
    var verificationSummary: ActionCardVerificationSummaryResponse? = null
    var readinessFailure: Throwable? = null
    var statusRequest: ActionCardStatusRequest? = null

    override suspend fun readiness(storeId: String, rangeStart: String, rangeEnd: String): DataReadinessResponse {
        readinessFailure?.let { throw it }
        return DataReadinessResponse("2026-08-01", "2026-08-07", listOf("revenue", "orders", "average_spend"), listOf("orders", "revenue"), listOf("average_spend"), "medium", true)
    }
    override suspend fun deterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String) = diagnostic
    override suspend fun diagnosticRun(storeId: String, diagnosticRunId: String) = DiagnosticRunResponse(
        diagnosticRunId,
        "revenue_decline",
        "2026-08-01",
        "2026-08-07",
        "2026-07-25",
        "2026-07-31",
        "revenue_decline_v1",
        "high",
        "2026-08-12T00:00:00.000Z",
        listOf(DiagnosticEvidenceResponse("revenue", 3826000, 4400000, -13.05))
    )
    override suspend fun actionCards(storeId: String, status: String?): List<ActionCardResponse> {
        this.status = status
        return listOf(ActionCardResponse("action_1", "revenue_decline", "2026-08-01", "2026-08-07", "检查午市套餐", "检查订单量", "下一周期营业额与订单数", "in_progress", null, null, null, verificationMetricKeys = listOf("revenue", "orders")))
    }
    override suspend fun verificationSummary(storeId: String, actionCardId: String) = verificationSummary
    override suspend fun updateActionCardStatus(
        storeId: String,
        actionCardId: String,
        request: ActionCardStatusRequest
    ): ActionCardResponse {
        statusRequest = request
        return ActionCardResponse(
            actionCardId,
            "revenue_decline",
            "2026-08-01",
            "2026-08-07",
            "Check menu placement",
            "Review placement",
            "Revenue",
            request.status,
            request.executionNote,
            request.verificationOutcome,
            null
        )
    }
}
