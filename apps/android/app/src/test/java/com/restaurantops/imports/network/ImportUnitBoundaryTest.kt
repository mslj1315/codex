package com.restaurantops.imports.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ImportUnitBoundaryTest {
    @Test
    fun `monetary cents display as yuan including fractional cents`() {
        assertEquals("48260", ImportUnitBoundary.displayValue("revenue", 4_826_000L, "cents"))
        assertEquals("38.50", ImportUnitBoundary.displayValue("average_spend", 3_850L, "cents"))
        assertEquals("元", ImportUnitBoundary.displayUnit("revenue", "cents"))
    }

    @Test
    fun `yuan form input converts to cents once while counts remain raw`() {
        assertEquals(
            ApiUnitValue(3_850L, "cents"),
            ImportUnitBoundary.parseDisplayInput("average_spend", "38.50", "yuan")
        )
        assertEquals(
            ApiUnitValue(12L, "count"),
            ImportUnitBoundary.parseDisplayInput("orders", "12", "count")
        )
        assertNull(ImportUnitBoundary.parseDisplayInput("revenue", "0", "yuan"))
        assertNull(ImportUnitBoundary.parseDisplayInput("average_spend", "-0.01", "yuan"))
        assertNull(ImportUnitBoundary.parseDisplayInput("average_spend", "38.999", "yuan"))
    }
}
