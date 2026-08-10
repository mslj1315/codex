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
    }
}
