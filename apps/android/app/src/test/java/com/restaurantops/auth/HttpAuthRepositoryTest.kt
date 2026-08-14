package com.restaurantops.auth

import kotlinx.coroutines.test.runTest
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HttpAuthRepositoryTest {
    private val store = StoreMembership("ent_a", "store_a", StoreRole.OWNER)

    @Test
    fun loginPersistsOnlyTheRefreshTokenAndLoadsStores() = runTest {
        val tokenStore = FakeRefreshTokenStore()
        val api = FakeAuthApi(
            loginTokens = AuthTokensResponse("access", "refresh", "2026-08-12T10:00:00Z"),
            stores = listOf(store)
        )
        val repository = HttpAuthRepository(api, tokenStore)

        assertEquals(listOf(store), repository.login("owner", "secret"))

        assertEquals("refresh", tokenStore.value)
        assertEquals("access", repository.accessToken)
        assertEquals("owner", api.loginRequest?.loginName)
        assertEquals("secret", api.loginRequest?.password)
        assertEquals("Bearer access", api.storesAuthorization)
    }

    @Test
    fun restoreRotatesTheStoredRefreshTokenBeforeLoadingStores() = runTest {
        val tokenStore = FakeRefreshTokenStore("previous-refresh")
        val api = FakeAuthApi(
            refreshTokens = AuthTokensResponse("new-access", "new-refresh", "2026-08-12T10:00:00Z"),
            stores = listOf(store)
        )
        val repository = HttpAuthRepository(api, tokenStore)

        assertEquals(listOf(store), repository.restore())

        assertEquals("previous-refresh", api.refreshRequest?.refreshToken)
        assertEquals("new-refresh", tokenStore.value)
        assertEquals("new-access", repository.accessToken)
        assertEquals("Bearer new-access", api.storesAuthorization)
    }

    @Test
    fun logoutClearsStoredTokensEvenWhenTheNetworkCallFails() = runTest {
        val tokenStore = FakeRefreshTokenStore("refresh")
        val api = FakeAuthApi(
            loginTokens = AuthTokensResponse("access", "refresh", "2026-08-12T10:00:00Z"),
            stores = listOf(store),
            logoutFailure = AuthRequestException(0, "offline")
        )
        val repository = HttpAuthRepository(api, tokenStore)
        repository.login("owner", "secret")

        try {
            repository.logout()
        } catch (_: AuthRequestException) {
        }

        assertNull(tokenStore.value)
        assertNull(repository.accessToken)
        assertEquals("Bearer access", api.logoutAuthorization)
    }

    @Test
    fun loginClearsInstalledTokensWhenLoadingStoresFails() = runTest {
        val tokenStore = FakeRefreshTokenStore()
        val api = FakeAuthApi(
            loginTokens = AuthTokensResponse("access", "refresh", "2026-08-12T10:00:00Z"),
            storesFailure = AuthRequestException(401, "Authentication required")
        )
        val repository = HttpAuthRepository(api, tokenStore)

        try {
            repository.login("owner", "secret")
        } catch (_: AuthRequestException) {
        }

        assertNull(repository.accessToken)
        assertNull(tokenStore.value)
    }

    @Test
    fun failedRefreshClearsTokensWithoutLeakingTheFailedSession() = runTest {
        val tokenStore = FakeRefreshTokenStore("refresh")
        val api = FakeAuthApi(refreshFailure = AuthRequestException(401, "Authentication required"))
        val repository = HttpAuthRepository(api, tokenStore)

        assertEquals(false, repository.refreshAccessToken("old-access"))

        assertNull(repository.accessToken)
        assertNull(tokenStore.value)
    }

    @Test
    fun storeLookupNetworkFailureIsMappedAndClearsTheInstalledSession() = runTest {
        val tokenStore = FakeRefreshTokenStore()
        val api = FakeAuthApi(
            loginTokens = AuthTokensResponse("access", "refresh", "2026-08-12T10:00:00Z"),
            storesFailure = IOException("offline")
        )
        val repository = HttpAuthRepository(api, tokenStore)

        try {
            repository.login("owner", "secret")
        } catch (error: Throwable) {
            assertEquals(AuthRequestException::class, error::class)
            assertEquals(0, (error as AuthRequestException).statusCode)
        }

        assertNull(repository.accessToken)
        assertNull(tokenStore.value)
    }

    private class FakeRefreshTokenStore(var value: String? = null) : RefreshTokenStore {
        override fun read(): String? = value
        override fun write(token: String) { value = token }
        override fun clear() { value = null }
    }

    private class FakeAuthApi(
        private val loginTokens: AuthTokensResponse? = null,
        private val refreshTokens: AuthTokensResponse? = null,
        private val stores: List<StoreMembership> = emptyList(),
        private val logoutFailure: Throwable? = null,
        private val storesFailure: Throwable? = null,
        private val refreshFailure: Throwable? = null
    ) : AuthApi {
        var loginRequest: LoginRequest? = null
        var refreshRequest: RefreshRequest? = null
        var storesAuthorization: String? = null
        var logoutAuthorization: String? = null

        override suspend fun login(body: LoginRequest): AuthTokensResponse {
            loginRequest = body
            return requireNotNull(loginTokens)
        }

        override suspend fun refresh(body: RefreshRequest): AuthTokensResponse {
            refreshRequest = body
            refreshFailure?.let { throw it }
            return requireNotNull(refreshTokens)
        }

        override suspend fun logout(authorization: String) {
            logoutAuthorization = authorization
            logoutFailure?.let { throw it }
        }

        override suspend fun stores(authorization: String): StoresResponse {
            storesAuthorization = authorization
            storesFailure?.let { throw it }
            return StoresResponse(stores.map { membership ->
            StoreMembershipResponse(membership.enterpriseId, membership.storeId, membership.role.name.lowercase())
            })
        }
    }
}
