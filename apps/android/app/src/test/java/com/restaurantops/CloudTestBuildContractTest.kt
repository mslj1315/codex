package com.restaurantops

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudTestBuildContractTest {
    @Test
    fun `cloud test variant targets the production HTTPS endpoint without changing debug or release`() {
        val buildScript = File("build.gradle.kts").readText()

        assertTrue(buildScript.contains("create(\"cloudTest\")"))
        assertTrue(buildScript.contains("initWith(getByName(\"debug\"))"))
        assertTrue(buildScript.contains("applicationIdSuffix = \".cloudtest\""))
        assertTrue(buildScript.contains("versionNameSuffix = \"-cloudtest\""))
        assertTrue(buildScript.contains("manifestPlaceholders[\"appLabel\"] = \"Restaurant Operations Cloud Test\""))
        assertTrue(buildScript.contains("buildConfigField(\"String\", \"LOCAL_API_BASE_URL\", \"\\\"https://app.msljkj.cn/\\\"\")"))
        assertTrue(buildScript.contains("buildConfigField(\"String\", \"LOCAL_API_BASE_URL\", \"\\\"http://10.0.2.2:3000/\\\"\")"))
        assertTrue(buildScript.contains("buildConfigField(\"String\", \"LOCAL_API_BASE_URL\", \"\\\"\\\"\")"))
        assertFalse(buildScript.contains("https://app.msljkj.cn/?"))
        assertFalse(buildScript.contains("https://app.msljkj.cn/#"))
    }
}
