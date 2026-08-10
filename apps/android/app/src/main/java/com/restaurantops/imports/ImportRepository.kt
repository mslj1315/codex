package com.restaurantops.imports

interface ImportRepository {
    fun loadImport(storeId: String, importId: String): ImportSummary

    fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary

    fun updateCandidate(
        storeId: String,
        importId: String,
        candidateId: String,
        update: ImportCandidateUpdate
    ): ImportSummary

    fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion
}
