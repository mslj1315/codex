package com.restaurantops.home

import java.io.IOException
import kotlinx.coroutines.runBlocking
import okhttp3.ResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class HttpOperationsHomeRepositoryTest {
    @Test
    fun `maps a confirmed period without raw import fields`() = runBlocking {
        val repository = HttpOperationsHomeRepository(
            FakeOperationsHomeApi(
                LatestConfirmedPeriodResponse(
                    LatestConfirmedPeriodPayload("2026-08-01", "2026-08-07", "2026-08-10T01:00:00.000Z")
                )
            )
        )

        val period = repository.loadLatestConfirmedPeriod("store_demo")

        assertEquals(
            ConfirmedOperationsPeriod("2026-08-01", "2026-08-07", "2026-08-10T01:00:00.000Z"),
            period
        )
        assertNull(LatestConfirmedPeriodPayload::class.java.declaredFields.singleOrNull { it.name == "batchId" })
        assertNull(LatestConfirmedPeriodPayload::class.java.declaredFields.singleOrNull { it.name == "factVersionId" })
        assertNull(LatestConfirmedPeriodPayload::class.java.declaredFields.singleOrNull { it.name == "objectKey" })
        assertNull(LatestConfirmedPeriodPayload::class.java.declaredFields.singleOrNull { it.name == "value" })
    }

    @Test
    fun `maps an absent period to null`() = runBlocking {
        val period = HttpOperationsHomeRepository(FakeOperationsHomeApi(LatestConfirmedPeriodResponse(null)))
            .loadLatestConfirmedPeriod("store_demo")

        assertNull(period)
    }

    @Test
    fun `maps HTTP and network failures to neutral typed home errors`() = runBlocking {
        val httpApi = FakeOperationsHomeApi().apply {
            failure = HttpException(Response.error<LatestConfirmedPeriodResponse>(422, ResponseBody.create(null, "{\"error\":\"private detail\"}")))
        }
        val networkApi = FakeOperationsHomeApi().apply { failure = IOException("private host") }

        val httpError = try {
            HttpOperationsHomeRepository(httpApi).loadLatestConfirmedPeriod("store_demo")
            error("Expected request failure")
        } catch (error: OperationsHomeRequestException) {
            error
        }
        val networkError = try {
            HttpOperationsHomeRepository(networkApi).loadLatestConfirmedPeriod("store_demo")
            error("Expected request failure")
        } catch (error: OperationsHomeRequestException) {
            error
        }

        assertEquals(422, httpError.statusCode)
        assertEquals("Unable to load the confirmed operations period", httpError.message)
        assertEquals(0, networkError.statusCode)
        assertEquals("Unable to reach the operations service", networkError.message)
    }

    @Test
    fun `rejects malformed period data instead of fabricating a valid range`() = runBlocking {
        val repository = HttpOperationsHomeRepository(
            FakeOperationsHomeApi(
                LatestConfirmedPeriodResponse(
                    LatestConfirmedPeriodPayload("2026-08-09", "2026-08-07", "not-a-time")
                )
            )
        )

        try {
            repository.loadLatestConfirmedPeriod("store_demo")
            error("Expected malformed response failure")
        } catch (error: OperationsHomeRequestException) {
            assertEquals(0, error.statusCode)
            assertEquals("Confirmed operations period is invalid", error.message)
        }
    }
}

private class FakeOperationsHomeApi(
    private val response: LatestConfirmedPeriodResponse = LatestConfirmedPeriodResponse(null)
) : OperationsHomeApi {
    var failure: Throwable? = null

    override suspend fun latestConfirmedPeriod(storeId: String): LatestConfirmedPeriodResponse {
        failure?.let { throw it }
        return response
    }
}
