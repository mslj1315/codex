package com.restaurantops.imports

interface ImportRepository {
    suspend fun loadImport(storeId: String, importId: String): ImportSummary

    suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary

    suspend fun updateCandidate(
        storeId: String,
        importId: String,
        candidateId: String,
        update: ImportCandidateUpdate
    ): ImportSummary

    suspend fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion

    suspend fun loadLatestFacts(storeId: String): FactVersion
}
