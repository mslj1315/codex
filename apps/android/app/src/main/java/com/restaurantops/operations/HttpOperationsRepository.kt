package com.restaurantops.operations

enum class OperationsConfidence { HIGH, MEDIUM, LOW }
data class DataReadiness(val missingMetrics: List<String>, val confidence: OperationsConfidence, val comparisonAvailable: Boolean)
data class DeterministicDiagnostic(val kind: String, val confidence: OperationsConfidence)
data class ActionCard(val id: String, val status: String, val title: String)
data class ActionVerificationSummary(val metrics: List<VerificationMetric>)
data class VerificationMetric(val metricKey: String, val baselineValue: Long, val comparisonValue: Long, val changePercent: Double)

interface OperationsRepository {
    suspend fun loadReadiness(storeId: String, rangeStart: String, rangeEnd: String): DataReadiness
    suspend fun loadDeterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String): DeterministicDiagnostic?
    suspend fun loadActionCards(storeId: String, status: String? = null): List<ActionCard>
    suspend fun loadVerificationSummary(storeId: String, actionCardId: String): ActionVerificationSummary?
}

class HttpOperationsRepository(private val api: OperationsApi) : OperationsRepository {
    override suspend fun loadReadiness(storeId: String, rangeStart: String, rangeEnd: String) = api.readiness(storeId, rangeStart, rangeEnd).let { DataReadiness(it.missingMetrics, it.confidence.toConfidence(), it.comparisonAvailable) }
    override suspend fun loadDeterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String) = api.deterministicDiagnostic(storeId, rangeStart, rangeEnd)?.let { DeterministicDiagnostic(it.kind, it.confidence.toConfidence()) }
    override suspend fun loadActionCards(storeId: String, status: String?) = api.actionCards(storeId, status).map { ActionCard(it.id, it.status, it.title) }
    override suspend fun loadVerificationSummary(storeId: String, actionCardId: String) = api.verificationSummary(storeId, actionCardId)?.let { ActionVerificationSummary(it.metrics.map { metric -> VerificationMetric(metric.metricKey, metric.baselineValue, metric.comparisonValue, metric.changePercent) }) }
}

private fun String.toConfidence() = when (this) {
    "high" -> OperationsConfidence.HIGH
    "medium" -> OperationsConfidence.MEDIUM
    "low" -> OperationsConfidence.LOW
    else -> throw IllegalArgumentException("Unknown operations confidence: $this")
}
