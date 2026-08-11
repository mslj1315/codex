package com.restaurantops.imports.network

import com.restaurantops.imports.FactVersion
import com.restaurantops.imports.ImportCandidate
import com.restaurantops.imports.ImportCandidateStatus
import com.restaurantops.imports.ImportCandidateUpdate
import com.restaurantops.imports.ImportBatchStatus
import com.restaurantops.imports.ImportRepository
import com.restaurantops.imports.ImportSourceType
import com.restaurantops.imports.ImportSummary
import com.restaurantops.imports.ManualImportDraft
import com.google.gson.Gson
import java.io.IOException
import retrofit2.HttpException

class ImportRequestException(
    val statusCode: Int,
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)

class HttpImportRepository(
    private val api: ImportApi
) : ImportRepository {
    private val summaries = mutableMapOf<ImportKey, ImportSummary>()

    override suspend fun loadImport(storeId: String, importId: String): ImportSummary = request {
        api.loadImport(storeId, importId).toSummary()
    }.also { summaries[ImportKey(storeId, importId)] = it }

    override suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary = request {
        api.createManualImport(storeId, draft.toRequest()).toSummary()
    }.also { summaries[ImportKey(storeId, it.id)] = it }

    override suspend fun updateCandidate(
        storeId: String,
        importId: String,
        candidateId: String,
        update: ImportCandidateUpdate
    ): ImportSummary {
        val key = ImportKey(storeId, importId)
        val current = summaries[key] ?: loadImport(storeId, importId)
        val updateRequest = ImportUnitBoundary.normalizeUpdate(current.candidates.first { it.id == candidateId }.metricKey, update)
        val updated = request { api.updateCandidate(storeId, importId, candidateId, updateRequest).toCandidate() }
        val summary = current.copy(candidates = current.candidates.map { candidate ->
            if (candidate.id == candidateId) updated else candidate
        })
        summaries[key] = summary
        return summary
    }

    override suspend fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion = request {
        api.confirm(storeId, importId, ConfirmImportRequest(candidateIds)).toFactVersion()
    }

    override suspend fun loadLatestFacts(storeId: String): FactVersion = request {
        api.latestFacts(storeId).toFactVersion()
    }

    private suspend fun <T> request(block: suspend () -> T): T = try {
        block()
    } catch (error: HttpException) {
        throw ImportRequestException(error.code(), error.apiErrorMessage(), error)
    } catch (error: IOException) {
        throw ImportRequestException(0, "Unable to reach the import service", error)
    }

    private data class ImportKey(val storeId: String, val importId: String)
}

private fun HttpException.apiErrorMessage(): String {
    val fallback = "Import request failed (${code()})"
    val body = response()?.errorBody() ?: return fallback
    return body.use { errorBody ->
        try {
            Gson().fromJson(errorBody.charStream(), ApiErrorBody::class.java)?.error?.takeIf { it.isNotBlank() } ?: fallback
        } catch (_: Exception) {
            fallback
        }
    }
}

private data class ApiErrorBody(val error: String?)

private fun ManualImportDraft.toRequest() = ManualImportRequest(
    rangeStart = rangeStart,
    rangeEnd = rangeEnd,
    candidates = candidates.map { candidate ->
        val normalized = ImportUnitBoundary.normalize(candidate.metricKey, candidate.value, candidate.unit)
        ManualCandidateRequest(
            metricKey = candidate.metricKey,
            metricDisplayName = candidate.metricDisplayName,
            value = normalized.value,
            unit = normalized.unit,
            rangeStart = candidate.rangeStart,
            rangeEnd = candidate.rangeEnd,
            sourceLocator = candidate.sourceLocator,
            confidence = candidate.confidence,
            status = candidate.status.toApiValue()
        )
    }
)

private fun ImportBatchResponse.toSummary() = ImportSummary(
    id = id,
    sourceType = sourceType.toSourceType(),
    status = status.toBatchStatus(),
    rangeStart = requireNotNull(rangeStart) { "Import batch rangeStart is required" },
    rangeEnd = requireNotNull(rangeEnd) { "Import batch rangeEnd is required" },
    candidates = candidates.map { it.toCandidate() }
)

private fun ImportCandidateResponse.toCandidate() = ImportCandidate(
    id = id,
    metricKey = metricKey,
    metricDisplayName = metricDisplayName,
    value = value,
    unit = unit,
    confidence = confidence,
    status = status.toCandidateStatus(),
    issueCode = issueCode,
    rangeStart = rangeStart,
    rangeEnd = rangeEnd,
    sourceLocator = sourceLocator
)

private fun FactVersionResponse.toFactVersion() = FactVersion(
    id = id,
    sourceImportId = sourceBatchId,
    status = confirmationStatus
)

private fun String.toSourceType() = when (this) {
    "csv" -> ImportSourceType.CSV
    "xlsx" -> ImportSourceType.XLSX
    "manual" -> ImportSourceType.MANUAL
    else -> throw IllegalArgumentException("Unknown import source type: $this")
}

private fun String.toCandidateStatus() = when (this) {
    "ready" -> ImportCandidateStatus.READY
    "needs_confirmation" -> ImportCandidateStatus.NEEDS_CONFIRMATION
    "confirmed" -> ImportCandidateStatus.CONFIRMED
    "rejected" -> ImportCandidateStatus.REJECTED
    else -> throw IllegalArgumentException("Unknown import candidate status: $this")
}

private fun String.toBatchStatus() = when (this) {
    "pending_confirmation" -> ImportBatchStatus.PENDING_CONFIRMATION
    "confirmed" -> ImportBatchStatus.CONFIRMED
    else -> throw IllegalArgumentException("Unknown import batch status: $this")
}

internal fun ImportCandidateStatus.toApiValue() = when (this) {
    ImportCandidateStatus.READY -> "ready"
    ImportCandidateStatus.NEEDS_CONFIRMATION -> "needs_confirmation"
    ImportCandidateStatus.CONFIRMED -> "confirmed"
    ImportCandidateStatus.REJECTED -> "rejected"
}
