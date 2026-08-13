package com.restaurantops.content

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ContentProfileEndpointTest {
    @Test fun releaseRequiresInjectedHttpsEndpointWhileDebugMayUseEmulatorLoopback() {
        assertFalse(contentProfileEndpointConfigured(""))
        assertFalse(contentProfileEndpointConfigured("http://example.test"))
        assertTrue(contentProfileEndpointConfigured("https://api.example.test"))
        assertTrue(contentProfileEndpointConfigured("http://10.0.2.2:3000"))
    }
}
