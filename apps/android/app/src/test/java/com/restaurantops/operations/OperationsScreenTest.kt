package com.restaurantops.operations

import org.junit.Assert.assertEquals
import org.junit.Test

class OperationsScreenTest {
    @Test
    fun `formats missing readiness metrics with catalog labels and key fallback`() {
        val labels = mapOf(
            "revenue" to "营业额（元）",
            "average_spend" to "客单价（元）"
        )

        assertEquals("缺少指标：营业额（元）、unknown_metric、客单价（元）", readinessMissingMetricsText(listOf("revenue", "unknown_metric", "average_spend"), labels))
        assertEquals(null, readinessMissingMetricsText(emptyList(), labels))
    }

    @Test
    fun `formats diagnostic evidence with catalog presentation and key fallback`() {
        val presentations = mapOf("revenue" to VerificationMetricPresentation("营业额", "cents"))
        assertEquals(
            "营业额：当前 38260 元，前期 44000 元，变化 -13.05%",
            formatDiagnosticEvidence(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05), presentations)
        )
        assertEquals(
            "unknown_metric：当前 12，前期 10，变化 20.0%",
            formatDiagnosticEvidence(DiagnosticEvidence("unknown_metric", 12, 10, 20.0), presentations)
        )
    }
}
