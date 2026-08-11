package com.restaurantops.imports.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

class HttpImportRepositoryTest {
    @Test
    fun `import API declares the local service contract without client identity fields`() {
        val api = ImportApi::class.java

        assertEndpoint(
            api.method("createManualImport"),
            POST::class.java,
            "/v1/stores/{storeId}/imports/manual"
        )
        assertEndpoint(
            api.method("loadImport"),
            GET::class.java,
            "/v1/stores/{storeId}/imports/{batchId}"
        )
        assertEndpoint(
            api.method("updateCandidate"),
            PATCH::class.java,
            "/v1/stores/{storeId}/imports/{batchId}/candidates/{candidateId}"
        )
        assertEndpoint(
            api.method("confirm"),
            POST::class.java,
            "/v1/stores/{storeId}/imports/{batchId}/confirm"
        )
        assertEndpoint(
            api.method("latestFacts"),
            GET::class.java,
            "/v1/stores/{storeId}/facts/latest"
        )

        assertEquals(setOf("rangeStart", "rangeEnd", "candidates"), ManualImportRequest::class.java.instanceFieldNames())
        assertEquals(setOf("candidateIds"), ConfirmImportRequest::class.java.instanceFieldNames())
        val create = api.method("createManualImport")
        assertNotNull(create.getAnnotation(POST::class.java))
        assertNotNull(create.parameterAnnotations[1].filterIsInstance<Body>().singleOrNull())
        assertEquals(1, create.parameterAnnotations[0].filterIsInstance<Path>().size)
    }

    private fun assertEndpoint(method: java.lang.reflect.Method, annotation: Class<out Annotation>, expectedPath: String) {
        val endpoint = method.getAnnotation(annotation)
        assertNotNull("${method.name} needs ${annotation.simpleName}", endpoint)
        val value = annotation.getMethod("value").invoke(endpoint) as String
        assertEquals(expectedPath, value)
    }

    private fun Class<ImportApi>.method(name: String): java.lang.reflect.Method =
        methods.single { it.name == name }

    private fun Class<*>.instanceFieldNames(): Set<String> =
        declaredFields.filterNot { java.lang.reflect.Modifier.isStatic(it.modifiers) }.map { it.name }.toSet()
}
