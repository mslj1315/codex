package com.restaurantops.home

import com.restaurantops.operations.ActionCard
import com.restaurantops.operations.ActionCardStatus
import com.restaurantops.operations.DataReadiness
import com.restaurantops.operations.OperationsConfidence
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OperationsHomeScreenTest {
    @Test
    fun `missing data model exposes import only and no fabricated operations`() {
        val model = OperationsHomeUiModel.from(OperationsHomeState.MissingData)

        assertTrue(model.importRequired)
        assertFalse(model.canViewOperations)
        assertFalse(model.canRetry)
        assertEquals(null, model.periodLabel)
        assertTrue(model.actionCards.isEmpty())
    }

    @Test
    fun `stale data model retains the known period and exposes import plus operations`() {
        val state = OperationsHomeState.Stale(
            ConfirmedOperationsPeriod("2026-06-01", "2026-06-07", "2026-06-15T00:00:00.000Z"),
            DataReadiness(listOf("average_spend"), OperationsConfidence.MEDIUM, false),
            null,
            listOf(ActionCard("action_1", ActionCardStatus.IN_PROGRESS, "Review lunch menu"))
        )

        val model = OperationsHomeUiModel.from(state)

        assertEquals("2026-06-01 至 2026-06-07", model.periodLabel)
        assertTrue(model.importRequired)
        assertTrue(model.canViewOperations)
        assertEquals(listOf("Review lunch menu"), model.actionCards.map { it.title })
    }

    @Test
    fun `failure model is retryable and uses its neutral message`() {
        val model = OperationsHomeUiModel.from(OperationsHomeState.Failure("运营数据暂时无法加载，请稍后重试"))

        assertTrue(model.canRetry)
        assertEquals("运营数据暂时无法加载，请稍后重试", model.message)
        assertFalse(model.importRequired)
    }
}
