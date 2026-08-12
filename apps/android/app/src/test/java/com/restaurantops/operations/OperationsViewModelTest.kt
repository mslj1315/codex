package com.restaurantops.operations

import com.restaurantops.imports.network.MetricCatalog
import com.restaurantops.imports.network.MetricCatalogRepository
import com.restaurantops.imports.network.MetricDefinition
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
    fun `uses cached catalog labels for action verification metrics`() = runTest {
        val catalogRepository = FakeMetricCatalogRepository(
            MetricCatalog(
                versionNumber = 1,
                definitions = listOf(
                    MetricDefinition("revenue", "营业额", "amount", "cents", true, true, true),
                    MetricDefinition("orders", "订单数", "count", "count", true, true, true)
                )
            )
        )
        val card = ActionCard(
            id = "action_1",
            status = ActionCardStatus.IN_PROGRESS,
            title = "Action card",
            verificationMetricKeys = listOf("revenue", "unknown_metric", "orders")
        )
        val viewModel = OperationsViewModel(
            FakeOperationsRepository(cards = listOf(card)),
            this,
            catalogRepository
        )

        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()
        viewModel.load("store_demo", "2026-08-08", "2026-08-14")
        advanceUntilIdle()

        assertEquals(
            mapOf("revenue" to "营业额（元）", "orders" to "订单数（次）"),
            viewModel.verificationMetricLabels
        )
        assertEquals(1, catalogRepository.requests)
        assertEquals(
            "验证指标：营业额（元）、unknown_metric、订单数（次）",
            verificationMetricKeysText(card.verificationMetricKeys, viewModel.verificationMetricLabels)
        )
    }

    @Test
    fun `catalog failure preserves action card loading and metric key fallback`() = runTest {
        val card = ActionCard(
            id = "action_1",
            status = ActionCardStatus.IN_PROGRESS,
            title = "Action card",
            verificationMetricKeys = listOf("revenue")
        )
        val viewModel = OperationsViewModel(
            FakeOperationsRepository(cards = listOf(card)),
            this,
            FakeMetricCatalogRepository(failure = IllegalStateException("private catalog failure"))
        )

        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()

        assertEquals(listOf(card), viewModel.actionCards)
        assertTrue(viewModel.verificationMetricLabels.isEmpty())
        assertNull(viewModel.requestError)
        assertEquals("验证指标：revenue", verificationMetricKeysText(card.verificationMetricKeys, viewModel.verificationMetricLabels))
    }

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

    @Test
    fun `loads frozen evidence only for the selected linked card`() = runTest {
        val linked = ActionCard("action_linked", ActionCardStatus.COMPLETED, "Linked", diagnosticRunId = "run_1")
        val manual = ActionCard("action_manual", ActionCardStatus.COMPLETED, "Manual")
        val detail = DiagnosticRunDetail("revenue_decline", "revenue_decline_v1", OperationsConfidence.HIGH, listOf(DiagnosticEvidence("revenue", 1000, 1200, -16.67)))
        val repository = FakeOperationsRepository(cards = listOf(linked, manual), diagnosticRun = detail)
        val viewModel = OperationsViewModel(repository, this)

        viewModel.loadActionCardDetails("store_demo", linked)
        advanceUntilIdle()
        assertEquals(linked.id, viewModel.selectedActionCardId)
        assertEquals(detail, viewModel.selectedDiagnosticRun)
        assertEquals(1, repository.diagnosticRunRequests)

        viewModel.loadActionCardDetails("store_demo", manual)
        advanceUntilIdle()
        assertEquals(manual.id, viewModel.selectedActionCardId)
        assertNull(viewModel.selectedDiagnosticRun)
        assertEquals(1, repository.diagnosticRunRequests)
    }

    @Test
    fun `evidence detail failure clears stale evidence but preserves verification summary`() = runTest {
        val linked = ActionCard("action_linked", ActionCardStatus.COMPLETED, "Linked", diagnosticRunId = "run_1")
        val summary = ActionVerificationSummary(listOf(VerificationMetric("revenue", 1000, 1100, 10.0)))
        val repository = FakeOperationsRepository(cards = listOf(linked), summary = summary).apply {
            diagnosticRunFailure = OperationsRequestException(503, "private detail")
        }
        val viewModel = OperationsViewModel(repository, this)

        viewModel.loadActionCardDetails("store_demo", linked)
        advanceUntilIdle()

        assertEquals(linked.id, viewModel.selectedActionCardId)
        assertEquals(summary, viewModel.verificationSummary)
        assertNull(viewModel.selectedDiagnosticRun)
        assertEquals("Unable to load operations data", viewModel.requestError)
    }

    @Test
    fun `successful update replaces only matching card and clears its summary`() = runTest {
        val proposed = ActionCard("action_1", ActionCardStatus.PROPOSED, "First")
        val other = ActionCard("action_2", ActionCardStatus.IN_PROGRESS, "Second")
        val summary = ActionVerificationSummary(listOf(VerificationMetric("revenue", 1000, 1100, 10.0)))
        val repository = FakeOperationsRepository(cards = listOf(proposed, other), summary = summary)
        val viewModel = OperationsViewModel(repository, this)
        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()
        viewModel.loadVerificationSummary("store_demo", proposed.id)
        advanceUntilIdle()

        viewModel.updateActionCard("store_demo", proposed.id, ActionCardUpdate.start())
        advanceUntilIdle()

        assertEquals(ActionCardStatus.IN_PROGRESS, viewModel.actionCards.first().status)
        assertEquals(other, viewModel.actionCards.last())
        assertNull(viewModel.verificationSummary)
        assertNull(viewModel.selectedActionCardId)
    }

    @Test
    fun `failed update retains cards summary and neutral error`() = runTest {
        val proposed = ActionCard("action_1", ActionCardStatus.PROPOSED, "First")
        val summary = ActionVerificationSummary(listOf(VerificationMetric("revenue", 1000, 1100, 10.0)))
        val repository = FakeOperationsRepository(cards = listOf(proposed), summary = summary).apply {
            updateFailure = OperationsRequestException(409, "private conflict")
        }
        val viewModel = OperationsViewModel(repository, this)
        viewModel.load("store_demo", "2026-08-01", "2026-08-07")
        advanceUntilIdle()
        viewModel.loadVerificationSummary("store_demo", proposed.id)
        advanceUntilIdle()

        viewModel.updateActionCard("store_demo", proposed.id, ActionCardUpdate.start())
        advanceUntilIdle()

        assertEquals(proposed, viewModel.actionCards.single())
        assertEquals(summary, viewModel.verificationSummary)
        assertEquals("Unable to load operations data", viewModel.requestError)
    }

    @Test
    fun `action card commands follow server status`() {
        assertEquals(
            setOf(ActionCardCommand.START, ActionCardCommand.CANCEL),
            ActionCardStatus.PROPOSED.nextCommands()
        )
        assertEquals(
            setOf(ActionCardCommand.COMPLETE, ActionCardCommand.CANCEL),
            ActionCardStatus.IN_PROGRESS.nextCommands()
        )
        assertEquals(setOf(ActionCardCommand.VERIFY), ActionCardStatus.COMPLETED.nextCommands())
        assertTrue(ActionCardStatus.VERIFIED.nextCommands().isEmpty())
        assertTrue(ActionCardStatus.CANCELLED.nextCommands().isEmpty())
        assertTrue(ActionCardStatus.COMPLETED.canViewVerificationSummary())
        assertTrue(ActionCardStatus.VERIFIED.canViewVerificationSummary())
        assertFalse(ActionCardStatus.IN_PROGRESS.canViewVerificationSummary())
    }

    @Test
    fun `execution note requires meaningful text within 500 characters`() {
        assertFalse(isValidExecutionNote("   "))
        assertTrue(isValidExecutionNote("a".repeat(500)))
        assertFalse(isValidExecutionNote("a".repeat(501)))
    }
}

private class FakeOperationsRepository(
    private val diagnostic: DeterministicDiagnostic? = DeterministicDiagnostic("revenue_decline", OperationsConfidence.HIGH),
    var failure: Throwable? = null,
    var diagnosticFailure: Throwable? = null,
    var summaryFailure: Throwable? = null,
    var diagnosticRunFailure: Throwable? = null,
    var updateFailure: Throwable? = null,
    private val summary: ActionVerificationSummary? = null,
    private val diagnosticRun: DiagnosticRunDetail = DiagnosticRunDetail("revenue_decline", "revenue_decline_v1", OperationsConfidence.HIGH, listOf(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05))),
    private val cards: List<ActionCard> = listOf(ActionCard("action_1", ActionCardStatus.IN_PROGRESS, "Action card"))
) : OperationsRepository {
    var diagnosticRunRequests = 0
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
    override suspend fun loadDiagnosticRun(storeId: String, diagnosticRunId: String): DiagnosticRunDetail {
        diagnosticRunRequests += 1
        diagnosticRunFailure?.let { throw it }
        return diagnosticRun
    }
    override suspend fun loadActionCards(storeId: String, status: String?) = cards
    override suspend fun loadVerificationSummary(
        storeId: String,
        actionCardId: String
    ): ActionVerificationSummary? {
        summaryFailure?.let { throw it }
        return summary
    }
    override suspend fun updateActionCard(
        storeId: String,
        actionCardId: String,
        update: ActionCardUpdate
    ): ActionCard {
        updateFailure?.let { throw it }
        return requireNotNull(cards.singleOrNull { it.id == actionCardId }).copy(
            status = update.status,
            executionNote = update.executionNote ?: cards.single { it.id == actionCardId }.executionNote,
            verificationOutcome = update.verificationOutcome ?: cards.single { it.id == actionCardId }.verificationOutcome
        )
    }
}

private class FakeMetricCatalogRepository(
    private val catalog: MetricCatalog? = null,
    private val failure: Throwable? = null
) : MetricCatalogRepository {
    var requests = 0

    override suspend fun loadMetricCatalog(storeId: String): MetricCatalog {
        requests += 1
        failure?.let { throw it }
        return requireNotNull(catalog)
    }
}
