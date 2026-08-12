package com.restaurantops.operations

import retrofit2.http.GET
import retrofit2.http.Body
import retrofit2.http.PATCH
import retrofit2.http.Path
import retrofit2.http.Query

interface OperationsApi {
    @GET("/v1/stores/{storeId}/readiness")
    suspend fun readiness(@Path("storeId") storeId: String, @Query("rangeStart") rangeStart: String, @Query("rangeEnd") rangeEnd: String): DataReadinessResponse

    @GET("/v1/stores/{storeId}/diagnostics/deterministic")
    suspend fun deterministicDiagnostic(@Path("storeId") storeId: String, @Query("rangeStart") rangeStart: String, @Query("rangeEnd") rangeEnd: String): DeterministicDiagnosticResponse?

    @GET("/v1/stores/{storeId}/action-cards")
    suspend fun actionCards(@Path("storeId") storeId: String, @Query("status") status: String? = null): List<ActionCardResponse>

    @GET("/v1/stores/{storeId}/action-cards/{actionCardId}/verification-summary")
    suspend fun verificationSummary(@Path("storeId") storeId: String, @Path("actionCardId") actionCardId: String): ActionCardVerificationSummaryResponse?

    @PATCH("/v1/stores/{storeId}/action-cards/{actionCardId}/status")
    suspend fun updateActionCardStatus(
        @Path("storeId") storeId: String,
        @Path("actionCardId") actionCardId: String,
        @Body request: ActionCardStatusRequest
    ): ActionCardResponse
}

data class DataReadinessResponse(val rangeStart: String, val rangeEnd: String, val requiredMetrics: List<String>, val presentMetrics: List<String>, val missingMetrics: List<String>, val confidence: String, val comparisonAvailable: Boolean)
data class DiagnosticFactResponse(val metricKey: String, val currentValue: Long, val priorValue: Long, val changePercent: Double)
data class DiagnosticEvidenceResponse(val metricKey: String, val currentValue: Long, val priorValue: Long, val changePercent: Double)
data class DeterministicDiagnosticResponse(val kind: String, val rangeStart: String, val rangeEnd: String, val priorRangeStart: String, val priorRangeEnd: String, val fact: DiagnosticFactResponse, val confidence: String, val diagnosticRunId: String = "", val ruleVersion: String = "", val evidence: List<DiagnosticEvidenceResponse> = emptyList())
data class ActionCardResponse(val id: String, val diagnosticKind: String, val rangeStart: String, val rangeEnd: String, val title: String, val action: String, val verificationMetric: String, val status: String, val executionNote: String?, val verificationOutcome: String?, val dueDate: String?, val diagnosticRunId: String? = null)
data class ActionCardVerificationSummaryResponse(val baselineRangeStart: String, val baselineRangeEnd: String, val comparisonRangeStart: String, val comparisonRangeEnd: String, val metrics: List<VerificationMetricResponse>)
data class VerificationMetricResponse(val metricKey: String, val baselineValue: Long, val comparisonValue: Long, val changePercent: Double)
data class ActionCardStatusRequest(
    val status: String,
    val executionNote: String? = null,
    val verificationOutcome: String? = null
)
