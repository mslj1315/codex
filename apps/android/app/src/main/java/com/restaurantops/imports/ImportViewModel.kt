package com.restaurantops.imports

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel

class ImportViewModel(
    private val repository: ImportRepository
) : ViewModel() {
    var summary by mutableStateOf<ImportSummary?>(null)
        private set

    var selectedSource by mutableStateOf(ImportSourceType.MANUAL)
        private set

    var confirmationMessage by mutableStateOf<String?>(null)
        private set

    val readyCandidateIds: List<String>
        get() = summary?.candidates.orEmpty()
            .filter { it.status == ImportCandidateStatus.READY }
            .map { it.id }

    val unresolvedCandidateIds: List<String>
        get() = summary?.candidates.orEmpty()
            .filter { it.status != ImportCandidateStatus.READY }
            .map { it.id }

    fun load(storeId: String, importId: String) {
        summary = repository.loadImport(storeId, importId)
        confirmationMessage = null
    }

    fun selectSource(sourceType: ImportSourceType) {
        selectedSource = sourceType
        confirmationMessage = null
    }

    fun createManualImport(storeId: String, draft: ManualImportDraft) {
        summary = repository.createManualImport(storeId, draft)
        selectedSource = ImportSourceType.MANUAL
        confirmationMessage = null
    }

    fun editCandidate(storeId: String, candidateId: String, value: Long, unit: String) {
        val currentSummary = summary ?: return
        val normalizedUnit = unit.trim().lowercase()
        val isResolved = value > 0 && normalizedUnit in CONFIRMABLE_UNITS
        summary = repository.updateCandidate(
            storeId = storeId,
            importId = currentSummary.id,
            candidateId = candidateId,
            update = ImportCandidateUpdate(
                value = value,
                unit = normalizedUnit,
                status = if (isResolved) {
                    ImportCandidateStatus.READY
                } else {
                    ImportCandidateStatus.NEEDS_CONFIRMATION
                }
            )
        )
        confirmationMessage = null
    }

    fun confirmReady(storeId: String) {
        val currentSummary = summary ?: return
        val candidateIds = readyCandidateIds
        if (candidateIds.isEmpty()) return

        repository.confirm(storeId, currentSummary.id, candidateIds)
        confirmationMessage = "已生成确认数据版本"
    }

    private companion object {
        val CONFIRMABLE_UNITS = setOf("yuan", "cents", "count", "times")
    }
}
