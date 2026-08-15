package com.restaurantops.auth

import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

interface AccessTokenSession {
    val accessToken: String?
    suspend fun refreshAccessToken(failedAccessToken: String): Boolean
    fun clearSession()
    fun invalidateSession() = clearSession()
}

class BearerInterceptor(
    private val session: AccessTokenSession
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.url().encodedPath().startsWith("/v1/auth/")) {
            return chain.proceed(request)
        }

        val accessToken = session.accessToken ?: return chain.proceed(request)
        val firstResponse = chain.proceed(request.withBearer(accessToken))
        if (firstResponse.code() != 401) return firstResponse

        val refreshed = runBlocking { session.refreshAccessToken(accessToken) }
        val renewedAccessToken = session.accessToken
        if (!refreshed || renewedAccessToken == null) {
            session.invalidateSession()
            return firstResponse
        }
        firstResponse.close()
        return chain.proceed(request.withBearer(renewedAccessToken))
    }

    private fun Request.withBearer(token: String): Request = newBuilder()
        .header("Authorization", "Bearer $token")
        .build()
}

class AuthenticatedApiClient(private val session: AccessTokenSession) {
    fun okHttpClient(): OkHttpClient = OkHttpClient.Builder().addInterceptor(BearerInterceptor(session)).build()
    fun retrofit(baseUrl: String): Retrofit = Retrofit.Builder()
        .baseUrl(baseUrl)
        .client(okHttpClient())
        .addConverterFactory(GsonConverterFactory.create())
        .build()
}
