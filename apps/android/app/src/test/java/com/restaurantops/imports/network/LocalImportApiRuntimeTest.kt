package com.restaurantops.imports.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalImportApiRuntimeTest {
    @Test
    fun `local API is enabled only for a debug build with a nonblank URL`() {
        assertTrue(LocalImportApiRuntime.canUseLocalApi(isDebug = true, baseUrl = "http://10.0.2.2:3000/"))
        assertFalse(LocalImportApiRuntime.canUseLocalApi(isDebug = false, baseUrl = "http://10.0.2.2:3000/"))
        assertFalse(LocalImportApiRuntime.canUseLocalApi(isDebug = true, baseUrl = "   "))
    }
}
