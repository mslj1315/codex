package com.restaurantops.home

import com.restaurantops.operations.ActionCard
import com.restaurantops.operations.ActionCardStatus
import com.restaurantops.operations.DataReadiness
import com.restaurantops.operations.DeterministicDiagnostic
import com.restaurantops.operations.DiagnosticRunDetail
import com.restaurantops.operations.OperationsConfidence
import com.restaurantops.operations.OperationsRepository
import com.restaurantops.operations.ActionCardUpdate
import com.restaurantops.operations.ActionVerificationSummary
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class OperationsHomeViewModelTest {
    @Test
    fun `current confirmed period loads the same range and only actionable cards`() = runTest {
        val period = ConfirmedOperationsPeriod("2026-08-01", "2026-08-07", "2026-08-10T01:00:00.000Z")
        val operations = FakeHomeOperationsRepository()
        val viewModel = OperationsHomeViewModel(FakeHomePeriodRepository(period), operations, this) {
            Instant.parse("2026-08-20T00:00:00.000Z")
        }

        viewModel.load("store_demo")
        advanceUntilIdle()

        val state = viewModel.state as OperationsHomeState.Current
        assertEquals(period, state.period)
        assertEquals(listOf("2026-08-01|2026-08-07"), operations.readinessRanges)
        assertEquals(listOf("2026-08-01|2026-08-07"), operations.diagnosticRanges)
        assertEquals(listOf("proposed", "in_progress"), state.actionCards.map { it.status.name.lowercase() })
    }

    @Test
    fun `stale period keeps server snapshot and requests import`() = runTest {
        val period = ConfirmedOperationsPeriod("2026-06-01", "2026-06-07", "2026-06-15T00:00:00.000Z")
        val viewModel = OperationsHomeViewModel(FakeHomePeriodRepository(period), FakeHomeOperationsRepository(), this) {
            Instant.parse("2026-08-20T00:00:00.000Z")
        }

        viewModel.load("store_demo")
        advanceUntilIdle()

        assertEquals(period, (viewModel.state as OperationsHomeState.Stale).period)
    }

    @Test
    fun `missing confirmed period skips all operations requests`() = runTest {
        val operations = FakeHomeOperationsRepository()
        val viewModel = OperationsHomeViewModel(FakeHomePeriodRepository(null), operations, this) { Instant.EPOCH }

        viewModel.load("store_demo")
        advanceUntilIdle()

        assertEquals(OperationsHomeState.MissingData, viewModel.state)
        assertTrue(operations.readinessRanges.isEmpty())
        assertTrue(operations.diagnosticRanges.isEmpty())
        assertEquals(0, operations.cardsRequests)
    }

    @Test
    fun `period load failure is retryable and does not expose backend details`() = runTest {
        val viewModel = OperationsHomeViewModel(
            FakeHomePeriodRepository(failure = OperationsHomeRequestException(503, "private server detail")),
            FakeHomeOperationsRepository(),
            this
        ) { Instant.EPOCH }

        viewModel.load("store_demo")
        advanceUntilIdle()

        val state = viewModel.state as OperationsHomeState.Failure
        assertTrue(state.retryable)
        assertFalse(state.message.contains("private"))
    }
}

private class FakeHomePeriodRepository(
    private val period: ConfirmedOperationsPeriod? = null,
    private val failure: Throwable? = null
) : OperationsHomeRepository {
    override suspend fun loadLatestConfirmedPeriod(storeId: String): ConfirmedOperationsPeriod? {
        failure?.let { throw it }
        return period
    }
}

private class FakeHomeOperationsRepository : OperationsRepository {
    val readinessRanges = mutableListOf<String>()
    val diagnosticRanges = mutableListOf<String>()
    var cardsRequests = 0
    override suspend fun loadReadiness(storeId: String, rangeStart: String, rangeEnd: String): DataReadiness {
        readinessRanges += "$rangeStart|$rangeEnd"
        return DataReadiness(emptyList(), OperationsConfidence.HIGH, true)
    }
    override suspend fun loadDeterministicDiagnostic(storeId: String, rangeStart: String, rangeEnd: String): DeterministicDiagnostic? {
        diagnosticRanges += "$rangeStart|$rangeEnd"
        return null
    }
    override suspend fun loadActionCards(storeId: String, status: String?): List<ActionCard> {
        cardsRequests += 1
        return listOf(
            ActionCard("proposed", ActionCardStatus.PROPOSED, "Proposed"),
            ActionCard("in_progress", ActionCardStatus.IN_PROGRESS, "In progress"),
            ActionCard("completed", ActionCardStatus.COMPLETED, "Completed")
        )
    }
    override suspend fun loadDiagnosticRun(storeId: String, diagnosticRunId: String): DiagnosticRunDetail = error("unused")
    override suspend fun loadVerificationSummary(storeId: String, actionCardId: String): ActionVerificationSummary? = error("unused")
    override suspend fun updateActionCard(storeId: String, actionCardId: String, update: ActionCardUpdate): ActionCard = error("unused")
}
