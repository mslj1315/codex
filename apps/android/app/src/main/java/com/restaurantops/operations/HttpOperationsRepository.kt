package com.restaurantops.operations

import java.io.IOException
import retrofit2.HttpException

class OperationsRequestException(val statusCode: Int, message: String, cause: Throwable? = null) : Exception(message, cause)

enum class OperationsConfidence { HIGH, MEDIUM, LOW }
enum class ActionCardStatus { PROPOSED, IN_PROGRESS, COMPLETED, VERIFIED, CANCELLED }
enum class ActionCardVerificationOutcome { EFFECTIVE, INEFFECTIVE, NOT_EXECUTED, DATA_INSUFFICIENT }
data class DataReadiness(val missingMetrics: List<String>, val confidence: OperationsConfidence, val comparisonAvailable: Boolean)
data class DeterministicDiagnostic(val kind: String, val confidence: OperationsConfidence)
data class ActionCard(
    val id: String,
    val status: ActionCardStatus,
    val title: String,
    val executionNote: String? = null,
    val verificationOutcome: ActionCardVerificationOutcome? = null
)
data class ActionCardUpdate(
    val status: ActionCardStatus,
    val executionNote: String? = null,
    val verificationOutcome: ActionCardVerificationOutcome? = null
) {
    companion object {
        fun start() = ActionCardUpdate(ActionCardStatus.IN_PROGRESS)
        fun cancel() = ActionCardUpdate(ActionCardStatus.CANCELLED)
        fun completed(note: String) = ActionCardUpdate(ActionCardStatus.COMPLETED, executionNote = note)
        fun verified(outcome: ActionCardVerificationOutcome) =
            ActionCardUpdate(ActionCardStatus.VERIFIED, verificationOutcome = outcome)
    }
}
data class ActionVerificationSummary(val metrics: List<VerificationMetric>)
data class VerificationMetric(val metricKey: String, val baselineValue: Long, val comparisonValue: Long, val changePercent: Double)

interface OperationsRepository {
    suspend fun loadReadiness(storeId: String, rangeStart: String, rangeEnd: String): DataReadiness
    suspend fun loadDeterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String): DeterministicDiagnostic?
    suspend fun loadActionCards(storeId: String, status: String? = null): List<ActionCard>
    suspend fun loadVerificationSummary(storeId: String, actionCardId: String): ActionVerificationSummary?
    suspend fun updateActionCard(storeId: String, actionCardId: String, update: ActionCardUpdate): ActionCard
}

class HttpOperationsRepository(private val api: OperationsApi) : OperationsRepository {
    override suspend fun loadReadiness(storeId: String, rangeStart: String, rangeEnd: String) = request { api.readiness(storeId, rangeStart, rangeEnd).let { DataReadiness(it.missingMetrics, it.confidence.toConfidence(), it.comparisonAvailable) } }
    override suspend fun loadDeterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String) = request { api.deterministicDiagnostic(storeId, rangeStart, rangeEnd)?.let { DeterministicDiagnostic(it.kind, it.confidence.toConfidence()) } }
    override suspend fun loadActionCards(storeId: String, status: String?) = request { api.actionCards(storeId, status).map(::toActionCard) }
    override suspend fun loadVerificationSummary(storeId: String, actionCardId: String) = request { api.verificationSummary(storeId, actionCardId)?.let { ActionVerificationSummary(it.metrics.map { metric -> VerificationMetric(metric.metricKey, metric.baselineValue, metric.comparisonValue, metric.changePercent) }) } }
    override suspend fun updateActionCard(storeId: String, actionCardId: String, update: ActionCardUpdate) = request {
        api.updateActionCardStatus(
            storeId,
            actionCardId,
            ActionCardStatusRequest(
                status = update.status.toWireValue(),
                executionNote = update.executionNote,
                verificationOutcome = update.verificationOutcome?.toWireValue()
            )
        ).let(::toActionCard)
    }

    private suspend fun <T> request(block: suspend () -> T): T = try {
        block()
    } catch (error: HttpException) {
        throw OperationsRequestException(error.code(), "Unable to load operations data", error)
    } catch (error: IOException) {
        throw OperationsRequestException(0, "Unable to reach the operations service", error)
    }
}

private fun toActionCard(response: ActionCardResponse) = ActionCard(
    id = response.id,
    status = response.status.toActionCardStatus(),
    title = response.title,
    executionNote = response.executionNote,
    verificationOutcome = response.verificationOutcome?.toActionCardVerificationOutcome()
)

private fun ActionCardStatus.toWireValue(): String = name.lowercase()
private fun ActionCardVerificationOutcome.toWireValue(): String = name.lowercase()
private fun String.toActionCardStatus(): ActionCardStatus = ActionCardStatus.entries.firstOrNull {
    it.toWireValue() == this
} ?: throw IllegalArgumentException("Unknown action card status")
private fun String.toActionCardVerificationOutcome(): ActionCardVerificationOutcome =
    ActionCardVerificationOutcome.entries.firstOrNull { it.toWireValue() == this }
        ?: throw IllegalArgumentException("Unknown action card verification outcome")

private fun String.toConfidence() = when (this) {
    "high" -> OperationsConfidence.HIGH
    "medium" -> OperationsConfidence.MEDIUM
    "low" -> OperationsConfidence.LOW
    else -> throw IllegalArgumentException("Unknown operations confidence: $this")
}
