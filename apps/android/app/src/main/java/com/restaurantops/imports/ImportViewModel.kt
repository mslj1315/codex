package com.restaurantops.imports

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

class ImportViewModel(
    private val repository: ImportRepository,
    private val scope: CoroutineScope? = null
) : ViewModel() {
    var summary by mutableStateOf<ImportSummary?>(null)
        private set

    var selectedSource by mutableStateOf(ImportSourceType.MANUAL)
        private set

    var confirmationMessage by mutableStateOf<String?>(null)
        private set

    private var isConfirmed by mutableStateOf(false)

    private val operationScope: CoroutineScope
        get() = scope ?: viewModelScope

    val isReadOnly: Boolean
        get() = isConfirmed

    val readyCandidateIds: List<String>
        get() = if (isConfirmed) emptyList() else summary?.candidates.orEmpty()
            .filter { it.status == ImportCandidateStatus.READY }
            .map { it.id }

    val unresolvedCandidateIds: List<String>
        get() = summary?.candidates.orEmpty()
            .filter { it.status != ImportCandidateStatus.READY }
            .map { it.id }

    fun load(storeId: String, importId: String) {
        operationScope.launch {
            summary = repository.loadImport(storeId, importId)
            isConfirmed = false
            confirmationMessage = null
        }
    }

    fun selectSource(sourceType: ImportSourceType) {
        selectedSource = sourceType
        confirmationMessage = null
    }

    fun createManualImport(storeId: String, draft: ManualImportDraft) {
        operationScope.launch {
            summary = repository.createManualImport(storeId, draft)
            selectedSource = ImportSourceType.MANUAL
            isConfirmed = false
            confirmationMessage = null
        }
    }

    fun editCandidate(storeId: String, candidateId: String, value: Long, unit: String) {
        val currentSummary = summary ?: return
        val candidate = currentSummary.candidates.firstOrNull { it.id == candidateId } ?: return
        if (candidate.status != ImportCandidateStatus.NEEDS_CONFIRMATION || isConfirmed) return
        val normalizedUnit = unit.trim().lowercase()
        val isResolved = value > 0 && normalizedUnit in CONFIRMABLE_UNITS
        operationScope.launch {
            summary = repository.updateCandidate(
                storeId = storeId,
                importId = currentSummary.id,
                candidateId = candidateId,
                update = ImportCandidateUpdate(
                    value = value,
                    unit = normalizedUnit,
                    status = if (isResolved) ImportCandidateStatus.READY else ImportCandidateStatus.NEEDS_CONFIRMATION
                )
            )
            confirmationMessage = null
        }
    }

    fun confirmReady(storeId: String) {
        val currentSummary = summary ?: return
        if (isConfirmed) return
        val candidateIds = readyCandidateIds
        if (candidateIds.isEmpty()) return
        operationScope.launch {
            repository.confirm(storeId, currentSummary.id, candidateIds)
            isConfirmed = true
            confirmationMessage = "\u5df2\u751f\u6210\u786e\u8ba4\u6570\u636e\u7248\u672c"
        }
    }

    private companion object {
        val CONFIRMABLE_UNITS = setOf("yuan", "cents", "count", "times")
    }
}
