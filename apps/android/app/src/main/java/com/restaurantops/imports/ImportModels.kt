package com.restaurantops.imports

enum class ImportSourceType {
    CSV,
    XLSX,
    MANUAL
}

enum class ImportCandidateStatus {
    READY,
    NEEDS_CONFIRMATION,
    CONFIRMED,
    REJECTED
}

data class ImportCandidate(
    val id: String,
    val metricKey: String,
    val metricDisplayName: String,
    val value: Long,
    val unit: String,
    val confidence: Int,
    val status: ImportCandidateStatus,
    val issueCode: String? = null,
    val rangeStart: String? = null,
    val rangeEnd: String? = null,
    val sourceLocator: String? = null
)

data class ImportSummary(
    val id: String,
    val sourceType: ImportSourceType,
    val rangeStart: String,
    val rangeEnd: String,
    val candidates: List<ImportCandidate>
)

data class FactVersion(
    val id: String,
    val sourceImportId: String,
    val status: String
)

data class ManualImportDraft(
    val rangeStart: String,
    val rangeEnd: String,
    val candidates: List<ImportCandidate>
)

data class ImportCandidateUpdate(
    val value: Long? = null,
    val unit: String? = null,
    val rangeStart: String? = null,
    val rangeEnd: String? = null,
    val status: ImportCandidateStatus? = null
)
