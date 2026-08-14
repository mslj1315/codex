package com.restaurantops.auth

import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthenticatedApiClientTest {
    @Test
    fun requestCarriesAccessTokenAndRetriesOnceAfter401() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401))
            server.enqueue(MockResponse().setResponseCode(200))
            val session = FakeSession("old-token", "new-token")
            val client = OkHttpClient.Builder().addInterceptor(BearerInterceptor(session)).build()

            client.newCall(Request.Builder().url(server.url("/v1/stores/store_a/readiness")).build()).execute().use { response ->
                assertEquals(200, response.code())
            }

            assertEquals("Bearer old-token", server.takeRequest().getHeader("Authorization"))
            assertEquals("Bearer new-token", server.takeRequest().getHeader("Authorization"))
            assertEquals(1, session.refreshCalls)
        }
    }

    @Test
    fun refreshFailureReturnsTheOriginalUnauthorizedResponseWithoutRetrying() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401))
            val session = FakeSession("old-token", null)
            val client = OkHttpClient.Builder().addInterceptor(BearerInterceptor(session)).build()

            client.newCall(Request.Builder().url(server.url("/v1/stores/store_a/readiness")).build()).execute().use { response ->
                assertEquals(401, response.code())
            }

            assertEquals(1, server.requestCount)
            assertEquals(1, session.refreshCalls)
            assertNull(session.accessToken)
        }
    }

    @Test
    fun authEndpointsNeverReceiveBearerCredentialsOrTriggerRefresh() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setResponseCode(401))
            val session = FakeSession("access-token", "new-token")
            val client = OkHttpClient.Builder().addInterceptor(BearerInterceptor(session)).build()

            client.newCall(Request.Builder().url(server.url("/v1/auth/refresh")).build()).execute().use { response ->
                assertEquals(401, response.code())
            }

            assertNull(server.takeRequest().getHeader("Authorization"))
            assertEquals(0, session.refreshCalls)
        }
    }

    private class FakeSession(
        initialAccessToken: String?,
        private val refreshedToken: String?
    ) : AccessTokenSession {
        override var accessToken: String? = initialAccessToken
            private set
        var refreshCalls = 0

        override suspend fun refreshAccessToken(failedAccessToken: String): Boolean {
            refreshCalls += 1
            accessToken = refreshedToken
            return refreshedToken != null
        }

        override fun clearSession() {
            accessToken = null
        }
    }
}
