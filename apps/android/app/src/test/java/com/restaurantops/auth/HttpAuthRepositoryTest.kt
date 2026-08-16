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

        assertEquals(AuthenticatedSession(listOf(store), passwordChangeRequired = false), repository.login("owner", "secret"))

        assertEquals("refresh", tokenStore.value)
        assertEquals("access", repository.accessToken)
        assertEquals("owner", api.loginRequests.single().loginName)
        assertEquals("secret", api.loginRequests.single().password)
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

        assertEquals(AuthenticatedSession(listOf(store), passwordChangeRequired = false), repository.restore())

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
    fun passwordChangeRequiredLoginDoesNotRequestCustomerStores() = runTest {
        val tokenStore = FakeRefreshTokenStore()
        val api = FakeAuthApi(loginTokens = AuthTokensResponse("access", "refresh", "2026-08-12T10:00:00Z", passwordChangeRequired = true))
        val repository = HttpAuthRepository(api, tokenStore)

        assertEquals(AuthenticatedSession(emptyList(), passwordChangeRequired = true), repository.login("13800138000", "temporary-password"))

        assertEquals(null, api.storesAuthorization)
        assertEquals("refresh", tokenStore.value)
    }

    @Test
    fun passwordChangeUsesTheCurrentSessionThenClearsItAndAuthenticatesWithTheNewPassword() = runTest {
        val tokenStore = FakeRefreshTokenStore()
        val api = FakeAuthApi(
            loginTokens = AuthTokensResponse("old-access", "old-refresh", "2026-08-12T10:00:00Z", passwordChangeRequired = true),
            reloginTokens = AuthTokensResponse("new-access", "new-refresh", "2026-08-12T10:00:00Z"),
            stores = listOf(store)
        )
        val repository = HttpAuthRepository(api, tokenStore)
        repository.login("13800138000", "temporary-password")

        assertEquals(AuthenticatedSession(listOf(store), passwordChangeRequired = false), repository.changePassword("13800138000", "temporary-password", "a-new-safe-password"))

        assertEquals("Bearer old-access", api.changePasswordAuthorization)
        assertEquals(ChangePasswordRequest("temporary-password", "a-new-safe-password"), api.changePasswordRequest)
        assertEquals(LoginRequest("13800138000", "a-new-safe-password"), api.loginRequests.last())
        assertEquals(1, tokenStore.clearCalls)
        assertEquals("new-refresh", tokenStore.value)
        assertEquals("new-access", repository.accessToken)
        assertEquals("Bearer new-access", api.storesAuthorization)
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
        var clearCalls = 0
        override fun read(): String? = value
        override fun write(token: String) { value = token }
        override fun clear() { clearCalls += 1; value = null }
    }

    private class FakeAuthApi(
        private val loginTokens: AuthTokensResponse? = null,
        private val reloginTokens: AuthTokensResponse? = null,
        private val refreshTokens: AuthTokensResponse? = null,
        private val stores: List<StoreMembership> = emptyList(),
        private val logoutFailure: Throwable? = null,
        private val storesFailure: Throwable? = null,
        private val refreshFailure: Throwable? = null
    ) : AuthApi {
        val loginRequests = mutableListOf<LoginRequest>()
        var refreshRequest: RefreshRequest? = null
        var storesAuthorization: String? = null
        var logoutAuthorization: String? = null
        var changePasswordAuthorization: String? = null
        var changePasswordRequest: ChangePasswordRequest? = null

        override suspend fun login(body: LoginRequest): AuthTokensResponse {
            loginRequests += body
            return if (loginRequests.size == 1) requireNotNull(loginTokens) else reloginTokens ?: requireNotNull(loginTokens)
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

        override suspend fun changePassword(authorization: String, body: ChangePasswordRequest) {
            changePasswordAuthorization = authorization
            changePasswordRequest = body
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
