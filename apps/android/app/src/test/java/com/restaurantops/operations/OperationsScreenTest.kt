package com.restaurantops.operations

import org.junit.Assert.assertEquals
import org.junit.Test

class OperationsScreenTest {
    @Test
    fun `formats public diagnostic evidence without identifiers`() {
        assertEquals(
            "revenue: current 3826000, prior 4400000, change -13.05%",
            formatDiagnosticEvidence(DiagnosticEvidence("revenue", 3826000, 4400000, -13.05))
        )
    }
}
