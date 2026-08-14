package com.restaurantops.auth

data class StoreMembership(
    val enterpriseId: String,
    val storeId: String,
    val role: StoreRole
)

enum class StoreRole {
    OWNER,
    OPERATOR
}

interface AuthRepository {
    suspend fun login(loginName: String, password: String): List<StoreMembership>
    suspend fun restore(): List<StoreMembership>
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
    data class Success(val stores: List<StoreMembership>) : LoginUiState
    data class Error(val message: String) : LoginUiState
}
