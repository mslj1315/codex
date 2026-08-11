package com.restaurantops.imports

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import com.restaurantops.imports.network.ImportRequestException

@OptIn(ExperimentalCoroutinesApi::class)
class ImportViewModelTest {
    @Test
    fun `unresolved candidates remain outside bulk confirmation`() {
        val repository = FakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, testScope())

        viewModel.load("store_demo", "import_1")

        assertEquals(listOf("candidate_ready"), viewModel.readyCandidateIds)
        assertEquals(listOf("candidate_unresolved"), viewModel.unresolvedCandidateIds)
    }

    @Test
    fun `editing an unresolved candidate leaves ready candidates unchanged`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, testScope())

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
        val viewModel = ImportViewModel(repository, testScope())

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
        val viewModel = ImportViewModel(repository, testScope())

        viewModel.load("store_demo", "import_1")
        viewModel.confirmReady("store_demo")

        assertEquals(listOf("candidate_ready"), repository.confirmedIds)
        assertEquals("已生成确认数据版本", viewModel.confirmationMessage)
    }

    @Test
    fun `confirmation is one-shot and removes ready candidates from eligibility`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, testScope())

        viewModel.load("store_demo", "import_1")
        viewModel.confirmReady("store_demo")
        viewModel.confirmReady("store_demo")

        assertEquals(1, repository.confirmCalls)
        assertEquals(emptyList<String>(), viewModel.readyCandidateIds)
        assertEquals("已生成确认数据版本", viewModel.confirmationMessage)
    }

    @Test
    fun `confirmation switches the local import to read only while preserving unresolved items`() {
        val repository = EditingFakeImportRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, testScope())

        viewModel.load("store_demo", "import_1")
        assertFalse(viewModel.isReadOnly)
        assertEquals(listOf("candidate_unresolved"), viewModel.unresolvedCandidateIds)

        viewModel.confirmReady("store_demo")

        assertTrue(viewModel.isReadOnly)
        assertEquals(listOf("candidate_unresolved"), viewModel.unresolvedCandidateIds)
    }

    @Test
    fun `loading a confirmed batch is read only and excludes terminal candidates from unresolved editors`() {
        val confirmedSummary = summaryWithReadyAndUnresolved.copy(
            status = ImportBatchStatus.CONFIRMED,
            candidates = summaryWithReadyAndUnresolved.candidates + listOf(
                summaryWithReadyAndUnresolved.candidates.first().copy(
                    id = "candidate_confirmed",
                    status = ImportCandidateStatus.CONFIRMED
                ),
                summaryWithReadyAndUnresolved.candidates.first().copy(
                    id = "candidate_rejected",
                    status = ImportCandidateStatus.REJECTED
                )
            )
        )
        val viewModel = ImportViewModel(FakeImportRepository(confirmedSummary), testScope())

        viewModel.load("store_demo", "import_1")

        assertTrue(viewModel.isReadOnly)
        assertEquals(emptyList<String>(), viewModel.readyCandidateIds)
        assertEquals(listOf("candidate_unresolved"), viewModel.unresolvedCandidateIds)
    }

    @Test
    fun `validation failure preserves summary and shows the server message`() = runTest {
        val repository = FailingCreateRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, this)

        viewModel.load("store_demo", "import_1")
        advanceUntilIdle()
        viewModel.createManualImport("store_demo", manualDraft())
        advanceUntilIdle()

        assertEquals(summaryWithReadyAndUnresolved, viewModel.summary)
        assertEquals("营业额必须大于 0", viewModel.requestError)
        assertFalse(viewModel.isLoading)
    }

    @Test
    fun `conflict reloads the current batch and leaves it usable`() = runTest {
        val refreshed = summaryWithReadyAndUnresolved.copy(
            candidates = listOf(summaryWithReadyAndUnresolved.candidates.first().copy(value = 5_000_000))
        )
        val repository = ConflictThenSuccessRepository(summaryWithReadyAndUnresolved, refreshed)
        val viewModel = ImportViewModel(repository, this)

        viewModel.load("store_demo", "import_1")
        advanceUntilIdle()
        viewModel.confirmReady("store_demo")
        advanceUntilIdle()

        assertEquals(refreshed, viewModel.summary)
        assertEquals("数据已发生变化，已刷新当前导入记录", viewModel.requestError)
        assertFalse(viewModel.isLoading)

        viewModel.confirmReady("store_demo")
        advanceUntilIdle()
        assertTrue(viewModel.isReadOnly)
        assertEquals(2, repository.confirmCalls)
    }

    @Test
    fun `duplicate confirmation is blocked while request is in flight`() = runTest {
        val repository = BlockingConfirmRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, this)

        viewModel.load("store_demo", "import_1")
        advanceUntilIdle()
        viewModel.confirmReady("store_demo")
        runCurrent()
        viewModel.confirmReady("store_demo")

        assertTrue(viewModel.isLoading)
        assertEquals(1, repository.confirmCalls)

        repository.releaseConfirmation()
        advanceUntilIdle()
        assertFalse(viewModel.isLoading)
        assertTrue(viewModel.isReadOnly)
    }

    @Test
    fun `candidate update conflict reloads the batch before actions resume`() = runTest {
        val refreshed = summaryWithReadyAndUnresolved.copy(status = ImportBatchStatus.CONFIRMED)
        val repository = UpdateConflictRepository(summaryWithReadyAndUnresolved, refreshed)
        val viewModel = ImportViewModel(repository, this)

        viewModel.load("store_demo", "import_1")
        advanceUntilIdle()
        viewModel.editCandidate("store_demo", "candidate_unresolved", 42, "yuan")
        advanceUntilIdle()

        assertEquals(refreshed, viewModel.summary)
        assertEquals("数据已发生变化，已刷新当前导入记录", viewModel.requestError)
        assertTrue(viewModel.isReadOnly)
        assertFalse(viewModel.isLoading)
    }

    @Test
    fun `transport failure uses the neutral connection message`() = runTest {
        val repository = TransportFailingCreateRepository(summaryWithReadyAndUnresolved)
        val viewModel = ImportViewModel(repository, this)

        viewModel.load("store_demo", "import_1")
        advanceUntilIdle()
        viewModel.createManualImport("store_demo", manualDraft())
        advanceUntilIdle()

        assertEquals("连接服务失败，请稍后重试", viewModel.requestError)
        assertEquals(summaryWithReadyAndUnresolved, viewModel.summary)
    }

    private class FakeImportRepository(
        private val summary: ImportSummary
    ) : ImportRepository {
        override suspend fun loadImport(storeId: String, importId: String): ImportSummary = summary

        override suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary = summary

        override suspend fun updateCandidate(
            storeId: String,
            importId: String,
            candidateId: String,
            update: ImportCandidateUpdate
        ): ImportSummary = summary

        override suspend fun confirm(
            storeId: String,
            importId: String,
            candidateIds: List<String>
        ): FactVersion = FactVersion("fact_1", "import_1", "confirmed")

        override suspend fun loadLatestFacts(storeId: String): FactVersion = FactVersion("fact_1", "import_1", "confirmed")
    }

    private class EditingFakeImportRepository(
        private val original: ImportSummary
    ) : ImportRepository {
        var confirmedIds: List<String> = emptyList()
        var updateCalls: Int = 0
        var confirmCalls: Int = 0

        override suspend fun loadImport(storeId: String, importId: String): ImportSummary = original

        override suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary = original

        override suspend fun updateCandidate(
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

        override suspend fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion {
            confirmCalls += 1
            confirmedIds = candidateIds
            return FactVersion("fact_1", "import_1", "confirmed")
        }

        override suspend fun loadLatestFacts(storeId: String): FactVersion = FactVersion("fact_1", "import_1", "confirmed")
    }

    private class FailingCreateRepository(
        private val summary: ImportSummary
    ) : ImportRepository by FakeImportRepository(summary) {
        override suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary {
            throw ImportRequestException(422, "营业额必须大于 0")
        }
    }

    private class ConflictThenSuccessRepository(
        private val initial: ImportSummary,
        private val refreshed: ImportSummary
    ) : ImportRepository by FakeImportRepository(initial) {
        var confirmCalls = 0
        var loadCalls = 0

        override suspend fun loadImport(storeId: String, importId: String): ImportSummary {
            loadCalls += 1
            return if (loadCalls == 1) initial else refreshed
        }

        override suspend fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion {
            confirmCalls += 1
            if (confirmCalls == 1) throw ImportRequestException(409, "conflict")
            return FactVersion("fact_1", importId, "confirmed")
        }
    }

    private class BlockingConfirmRepository(
        private val summary: ImportSummary
    ) : ImportRepository by FakeImportRepository(summary) {
        private val confirmation = CompletableDeferred<Unit>()
        var confirmCalls = 0

        override suspend fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion {
            confirmCalls += 1
            confirmation.await()
            return FactVersion("fact_1", importId, "confirmed")
        }

        fun releaseConfirmation() {
            confirmation.complete(Unit)
        }
    }

    private class UpdateConflictRepository(
        private val initial: ImportSummary,
        private val refreshed: ImportSummary
    ) : ImportRepository by FakeImportRepository(initial) {
        private var loadCalls = 0

        override suspend fun loadImport(storeId: String, importId: String): ImportSummary {
            loadCalls += 1
            return if (loadCalls == 1) initial else refreshed
        }

        override suspend fun updateCandidate(
            storeId: String,
            importId: String,
            candidateId: String,
            update: ImportCandidateUpdate
        ): ImportSummary = throw ImportRequestException(409, "stale candidate")
    }

    private class TransportFailingCreateRepository(
        private val summary: ImportSummary
    ) : ImportRepository by FakeImportRepository(summary) {
        override suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary {
            throw ImportRequestException(0, "socket closed")
        }
    }

    private companion object {
        fun testScope() = CoroutineScope(Dispatchers.Unconfined)
        fun manualDraft() = ManualImportDraft(
            rangeStart = "2026-08-01",
            rangeEnd = "2026-08-07",
            candidates = emptyList()
        )
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
