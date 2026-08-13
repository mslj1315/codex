package com.restaurantops.home

import retrofit2.http.GET
import retrofit2.http.Path

interface OperationsHomeApi {
    @GET("/v1/stores/{storeId}/operations/latest-confirmed-period")
    suspend fun latestConfirmedPeriod(@Path("storeId") storeId: String): LatestConfirmedPeriodResponse
}

data class LatestConfirmedPeriodResponse(
    val period: LatestConfirmedPeriodPayload?
)

data class LatestConfirmedPeriodPayload(
    val rangeStart: String,
    val rangeEnd: String,
    val confirmedAt: String
)
