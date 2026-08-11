package com.restaurantops.imports.network

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LocalApiManifestContractTest {
    @Test
    fun `debug permits local cleartext API traffic while main manifest remains restrictive`() {
        val debugManifest = File("src/debug/AndroidManifest.xml").readText()
        val mainManifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue(debugManifest.contains("android:usesCleartextTraffic=\"true\""))
        assertFalse(mainManifest.contains("usesCleartextTraffic"))
    }
}
