package com.restaurantops.operations

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OperationsRuntimeTest {
    @Test
    fun `debug local API configuration enables HTTP operations`() {
        assertTrue(OperationsRuntime.canUseHttpRepository(true, "http://10.0.2.2:3000/"))
        assertFalse(OperationsRuntime.canUseHttpRepository(false, "http://10.0.2.2:3000/"))
        assertFalse(OperationsRuntime.canUseHttpRepository(true, "   "))
    }

    @Test
    fun `unavailable runtime does not fabricate operations data`() = runBlocking {
        val error = try {
            UnavailableOperationsRepository().loadReadiness("store_demo", "2026-08-01", "2026-08-07")
            error("Expected unavailable service")
        } catch (error: OperationsServiceUnavailableException) {
            error
        }

        assertTrue(error.message!!.contains("not configured"))
    }
}
