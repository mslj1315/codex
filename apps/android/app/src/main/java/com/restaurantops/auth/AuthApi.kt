package com.restaurantops.auth

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface AuthApi {
    @POST("/v1/auth/login")
    suspend fun login(@Body body: LoginRequest): AuthTokensResponse

    @POST("/v1/auth/refresh")
    suspend fun refresh(@Body body: RefreshRequest): AuthTokensResponse

    @POST("/v1/auth/logout")
    suspend fun logout(@Header("Authorization") authorization: String)

    @GET("/v1/auth/me/stores")
    suspend fun stores(@Header("Authorization") authorization: String): StoresResponse
}

data class LoginRequest(val loginName: String, val password: String)
data class RefreshRequest(val refreshToken: String)
data class AuthTokensResponse(val accessToken: String, val refreshToken: String, val expiresAt: String)
data class StoresResponse(val stores: List<StoreMembershipResponse>)
data class StoreMembershipResponse(val enterpriseId: String, val storeId: String, val role: String)
