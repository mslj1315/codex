package com.restaurantops.home

import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import retrofit2.HttpException

data class ConfirmedOperationsPeriod(
    val rangeStart: String,
    val rangeEnd: String,
    val confirmedAt: String
)

interface OperationsHomeRepository {
    suspend fun loadLatestConfirmedPeriod(storeId: String): ConfirmedOperationsPeriod?
}

class OperationsHomeRequestException(
    val statusCode: Int,
    message: String,
    cause: Throwable? = null
) : Exception(message, cause)

class HttpOperationsHomeRepository(
    private val api: OperationsHomeApi
) : OperationsHomeRepository {
    override suspend fun loadLatestConfirmedPeriod(storeId: String): ConfirmedOperationsPeriod? = try {
        api.latestConfirmedPeriod(storeId).period?.toConfirmedOperationsPeriod()
    } catch (error: HttpException) {
        throw OperationsHomeRequestException(error.code(), "Unable to load the confirmed operations period", error)
    } catch (error: IOException) {
        throw OperationsHomeRequestException(0, "Unable to reach the operations service", error)
    }
}

private fun LatestConfirmedPeriodPayload.toConfirmedOperationsPeriod(): ConfirmedOperationsPeriod = try {
    val start = LocalDate.parse(rangeStart)
    val end = LocalDate.parse(rangeEnd)
    check(!start.isAfter(end))
    Instant.parse(confirmedAt)
    ConfirmedOperationsPeriod(rangeStart, rangeEnd, confirmedAt)
} catch (error: Exception) {
    throw OperationsHomeRequestException(0, "Confirmed operations period is invalid", error)
}
