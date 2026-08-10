package com.restaurantops.imports

import org.junit.Assert.assertEquals
import org.junit.Test

class ImportViewModelTest {
    @Test
    fun `unresolved candidates remain outside bulk confirmation`() {
        val repository = FakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository)

        viewModel.load("store_demo", "import_1")

        assertEquals(listOf("candidate_ready"), viewModel.readyCandidateIds)
        assertEquals(listOf("candidate_unresolved"), viewModel.unresolvedCandidateIds)
    }

    private class FakeImportRepository(
        private val summary: ImportSummary
    ) : ImportRepository {
        override fun loadImport(storeId: String, importId: String): ImportSummary = summary

        override fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary = summary

        override fun updateCandidate(
            storeId: String,
            importId: String,
            candidateId: String,
            update: ImportCandidateUpdate
        ): ImportSummary = summary

        override fun confirm(
            storeId: String,
            importId: String,
            candidateIds: List<String>
        ): FactVersion = FactVersion("fact_1", "import_1", "confirmed")
    }

    private companion object {
        val summaryWithReadyAndUnresolved = ImportSummary(
            id = "import_1",
            sourceType = ImportSourceType.MANUAL,
            rangeStart = "2026-08-01",
            rangeEnd = "2026-08-07",
            candidates = listOf(
                ImportCandidate(
                    id = "candidate_ready",
                    metricKey = "revenue",
                    metricDisplayName = "Revenue",
                    value = 4_826_000,
                    unit = "cents",
                    confidence = 100,
                    status = ImportCandidateStatus.READY
                ),
                ImportCandidate(
                    id = "candidate_unresolved",
                    metricKey = "average_spend",
                    metricDisplayName = "Average spend",
                    value = 38,
                    unit = "unknown",
                    confidence = 0,
                    status = ImportCandidateStatus.NEEDS_CONFIRMATION,
                    issueCode = "unit_missing"
                )
            )
        )
    }
}
