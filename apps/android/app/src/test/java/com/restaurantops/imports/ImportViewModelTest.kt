package com.restaurantops.imports

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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

    @Test
    fun `editing an unresolved candidate leaves ready candidates unchanged`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository)

        viewModel.load("store_demo", "import_1")
        viewModel.editCandidate(
            storeId = "store_demo",
            candidateId = "candidate_unresolved",
            value = 42,
            unit = "yuan"
        )

        assertEquals(
            listOf("candidate_ready", "candidate_unresolved"),
            viewModel.readyCandidateIds
        )
        assertFalse(viewModel.unresolvedCandidateIds.contains("candidate_ready"))
        assertEquals(emptyList<String>(), viewModel.unresolvedCandidateIds)
        assertEquals(42, viewModel.summary!!.candidates.last().value)
    }

    @Test
    fun `editing a ready candidate is rejected before reaching the repository`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository)

        viewModel.load("store_demo", "import_1")
        viewModel.editCandidate(
            storeId = "store_demo",
            candidateId = "candidate_ready",
            value = 1,
            unit = "yuan"
        )

        assertEquals(0, repository.updateCalls)
        assertEquals(4_826_000, viewModel.summary!!.candidates.first().value)
        assertEquals(listOf("candidate_ready"), viewModel.readyCandidateIds)
    }

    @Test
    fun `bulk confirmation submits only ready candidates`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository)

        viewModel.load("store_demo", "import_1")
        viewModel.confirmReady("store_demo")

        assertEquals(listOf("candidate_ready"), repository.confirmedIds)
        assertEquals("已生成确认数据版本", viewModel.confirmationMessage)
    }

    @Test
    fun `confirmation is one-shot and removes ready candidates from eligibility`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository)

        viewModel.load("store_demo", "import_1")
        viewModel.confirmReady("store_demo")
        viewModel.confirmReady("store_demo")

        assertEquals(1, repository.confirmCalls)
        assertEquals(emptyList<String>(), viewModel.readyCandidateIds)
        assertEquals("已生成确认数据版本", viewModel.confirmationMessage)
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

    private class EditingFakeImportRepository(
        private val original: ImportSummary
    ) : ImportRepository {
        var confirmedIds: List<String> = emptyList()
        var updateCalls: Int = 0
        var confirmCalls: Int = 0

        override fun loadImport(storeId: String, importId: String): ImportSummary = original

        override fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary = original

        override fun updateCandidate(
            storeId: String,
            importId: String,
            candidateId: String,
            update: ImportCandidateUpdate
        ): ImportSummary {
            updateCalls += 1
            return original.copy(
                candidates = original.candidates.map { candidate ->
                    if (candidate.id == candidateId) {
                        candidate.copy(
                            value = update.value ?: candidate.value,
                            unit = update.unit ?: candidate.unit,
                            status = update.status ?: candidate.status
                        )
                    } else {
                        candidate
                    }
                }
            )
        }

        override fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion {
            confirmCalls += 1
            confirmedIds = candidateIds
            return FactVersion("fact_1", "import_1", "confirmed")
        }
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
