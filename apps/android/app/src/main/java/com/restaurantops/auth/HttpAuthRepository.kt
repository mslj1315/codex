package com.restaurantops.auth

import java.io.IOException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import retrofit2.HttpException

interface RefreshTokenStore {
    fun read(): String?
    fun write(token: String)
    fun clear()
}

class HttpAuthRepository(
    private val api: AuthApi,
    private val refreshTokenStore: RefreshTokenStore
) : AuthRepository, AccessTokenSession {
    @Volatile
    var onSessionInvalidated: (() -> Unit)? = null

    override var accessToken: String? = null
        private set

    override suspend fun login(loginName: String, password: String): List<StoreMembership> =
        installAndLoadStores { api.login(LoginRequest(loginName, password)) }

    override suspend fun restore(): List<StoreMembership> {
        val refreshToken = refreshTokenStore.read() ?: return emptyList()
        return installAndLoadStores { api.refresh(RefreshRequest(refreshToken)) }
    }

    override suspend fun logout() {
        try {
            accessToken?.let { token -> request { api.logout(token.toBearerHeader()) } }
        } finally {
            clearSession()
        }
    }

    override suspend fun refreshAccessToken(failedAccessToken: String): Boolean = refreshMutex.withLock {
        if (accessToken != null && accessToken != failedAccessToken) {
            return@withLock true
        }
        val refreshToken = refreshTokenStore.read() ?: return@withLock false
        return@withLock try {
            request { api.refresh(RefreshRequest(refreshToken)).also(::installTokens) }
            true
        } catch (_: AuthRequestException) {
            clearSession()
            false
        }
    }

    override fun clearSession() {
        accessToken = null
        refreshTokenStore.clear()
    }

    override fun invalidateSession() {
        clearSession()
        onSessionInvalidated?.invoke()
    }

    private suspend fun loadStores(): List<StoreMembership> = request {
        api.stores(requireNotNull(accessToken).toBearerHeader()).stores.map { response ->
        StoreMembership(
            enterpriseId = response.enterpriseId,
            storeId = response.storeId,
            role = StoreRole.entries.firstOrNull { it.name.equals(response.role, ignoreCase = true) }
                ?: throw AuthRequestException(0, "Invalid store membership response")
        )
        }
    }

    private fun installTokens(tokens: AuthTokensResponse) {
        accessToken = tokens.accessToken
        refreshTokenStore.write(tokens.refreshToken)
    }

    private suspend fun installAndLoadStores(tokens: suspend () -> AuthTokensResponse): List<StoreMembership> = try {
        request { tokens().also(::installTokens) }
        loadStores().also { stores -> if (stores.isEmpty()) clearSession() }
    } catch (error: Throwable) {
        clearSession()
        throw error
    }

    private fun String.toBearerHeader() = "Bearer $this"

    private suspend fun <T> request(block: suspend () -> T): T = try {
        block()
    } catch (error: HttpException) {
        throw AuthRequestException(error.code(), "Authentication required", error)
    } catch (error: IOException) {
        throw AuthRequestException(0, "Unable to reach the authentication service", error)
    }

    private companion object {
        val refreshMutex = Mutex()
    }
}
