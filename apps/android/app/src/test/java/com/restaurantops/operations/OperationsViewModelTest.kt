package com.restaurantops.operations

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class OperationsViewModelTest {
    @Test
    fun `loads readiness optional diagnostic and action cards into one screen state`() = runTest {
        val viewModel = OperationsViewModel(FakeOperationsRepository(), this)
        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()

        assertFalse(viewModel.isLoading)
        assertNull(viewModel.requestError)
        assertEquals(OperationsConfidence.MEDIUM, viewModel.readiness!!.confidence)
        assertEquals("revenue_decline", viewModel.diagnostic!!.kind)
        assertEquals(listOf("action_1"), viewModel.actionCards.map { it.id })
    }

    @Test
    fun `keeps no diagnostic distinct from a request failure`() = runTest {
        val noDiagnostic = OperationsViewModel(FakeOperationsRepository(diagnostic = null), this)
        noDiagnostic.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()
        assertNull(noDiagnostic.diagnostic)
        assertNull(noDiagnostic.requestError)

        val failure = OperationsViewModel(FakeOperationsRepository(failure = OperationsRequestException(0, "private host")), this)
        failure.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()
        assertNull(failure.readiness)
        assertEquals("Unable to reach the operations service", failure.requestError)
    }

    @Test
    fun `configured unavailable source stays distinct from a network error`() = runTest {
        val viewModel = OperationsViewModel(UnavailableOperationsRepository(), this)

        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()

        assertTrue(viewModel.isServiceUnavailable)
        assertNull(viewModel.requestError)
        assertNull(viewModel.readiness)
    }

    @Test
    fun `failed refresh preserves the previously displayed operations state`() = runTest {
        val repository = FakeOperationsRepository()
        val viewModel = OperationsViewModel(repository, this)
        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()

        repository.diagnosticFailure = OperationsRequestException(503, "private service detail")
        viewModel.load("store_demo", "2026-08-08", "2026-08-14")
        advanceUntilIdle()

        assertEquals(OperationsConfidence.MEDIUM, viewModel.readiness!!.confidence)
        assertEquals("revenue_decline", viewModel.diagnostic!!.kind)
        assertEquals(listOf("action_1"), viewModel.actionCards.map { it.id })
        assertEquals("Unable to load operations data", viewModel.requestError)
    }

    @Test
    fun `loads selected action verification summary without changing action cards`() = runTest {
        val summary = ActionVerificationSummary(
            listOf(VerificationMetric("revenue", 1000, 1100, 10.0))
        )
        val viewModel = OperationsViewModel(FakeOperationsRepository(summary = summary), this)

        viewModel.loadVerificationSummary("store_demo", "action_1")
        advanceUntilIdle()

        assertEquals("action_1", viewModel.selectedActionCardId)
        assertEquals(summary, viewModel.verificationSummary)
        assertTrue(viewModel.actionCards.isEmpty())
    }

    @Test
    fun `summary failure retains prior data and maps a neutral message`() = runTest {
        val summary = ActionVerificationSummary(
            listOf(VerificationMetric("revenue", 1000, 1100, 10.0))
        )
        val repository = FakeOperationsRepository(summary = summary)
        val viewModel = OperationsViewModel(repository, this)
        viewModel.loadVerificationSummary("store_demo", "action_1")
        advanceUntilIdle()

        repository.summaryFailure = OperationsRequestException(503, "private detail")
        viewModel.loadVerificationSummary("store_demo", "action_2")
        advanceUntilIdle()

        assertEquals(summary, viewModel.verificationSummary)
        assertEquals("Unable to load operations data", viewModel.requestError)
    }
}

private class FakeOperationsRepository(
    private val diagnostic: DeterministicDiagnostic? = DeterministicDiagnostic("revenue_decline", OperationsConfidence.HIGH),
    var failure: Throwable? = null,
    var diagnosticFailure: Throwable? = null,
    var summaryFailure: Throwable? = null,
    private val summary: ActionVerificationSummary? = null
) : OperationsRepository {
    override suspend fun loadReadiness(storeId: String, rangeStart: String, rangeEnd: String): DataReadiness {
        failure?.let { throw it }
        return DataReadiness(listOf("average_spend"), OperationsConfidence.MEDIUM, true)
    }
    override suspend fun loadDeterministicDiagnostic(
        storeId: String,
        rangeStart: String,
        rangeEnd: String
    ): DeterministicDiagnostic? {
        diagnosticFailure?.let { throw it }
        return diagnostic
    }
    override suspend fun loadActionCards(storeId: String, status: String?) = listOf(ActionCard("action_1", "in_progress", "检查午市套餐"))
    override suspend fun loadVerificationSummary(
        storeId: String,
        actionCardId: String
    ): ActionVerificationSummary? {
        summaryFailure?.let { throw it }
        return summary
    }
}
