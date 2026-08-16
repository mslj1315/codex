package com.restaurantops.auth

data class StoreMembership(
    val enterpriseId: String,
    val storeId: String,
    val role: StoreRole
)

data class AuthenticatedSession(
    val stores: List<StoreMembership>,
    val passwordChangeRequired: Boolean
)

enum class StoreRole {
    OWNER,
    OPERATOR
}

interface AuthRepository {
    suspend fun login(loginName: String, password: String): AuthenticatedSession
    suspend fun restore(): AuthenticatedSession
    suspend fun changePassword(loginName: String, currentPassword: String, newPassword: String): AuthenticatedSession
    suspend fun logout()
}

class AuthRequestException(
    val statusCode: Int,
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)

sealed interface LoginUiState {
    data object Idle : LoginUiState
    data object Loading : LoginUiState
    data class Success(val loginName: String, val session: AuthenticatedSession) : LoginUiState
    data class Error(val message: String) : LoginUiState
}
