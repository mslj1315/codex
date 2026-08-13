package com.restaurantops.operations

import com.restaurantops.imports.network.LocalImportApiRuntime
import com.restaurantops.imports.network.HttpMetricCatalogRepository
import com.restaurantops.imports.network.ImportApi
import com.restaurantops.imports.network.MetricCatalogRepository
import com.restaurantops.imports.network.UnavailableMetricCatalogRepository
import com.restaurantops.auth.AuthenticatedApiClient
import com.restaurantops.home.HttpOperationsHomeRepository
import com.restaurantops.home.OperationsHomeApi
import com.restaurantops.home.OperationsHomeRepository
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class OperationsServiceUnavailableException : Exception("Operations service is not configured")

object OperationsRuntime {
    fun canUseHttpRepository(isDebug: Boolean, baseUrl: String): Boolean =
        LocalImportApiRuntime.canUseLocalApi(isDebug, baseUrl)

    fun repository(isDebug: Boolean, baseUrl: String): OperationsRepository =
        if (canUseHttpRepository(isDebug, baseUrl)) {
            HttpOperationsRepository(
                Retrofit.Builder()
                    .baseUrl(baseUrl)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()
                    .create(OperationsApi::class.java)
            )
        } else {
            UnavailableOperationsRepository()
        }

    fun repository(baseUrl: String, authenticatedApiClient: AuthenticatedApiClient): OperationsRepository =
        HttpOperationsRepository(authenticatedApiClient.retrofit(baseUrl).create(OperationsApi::class.java))

    fun homeRepository(baseUrl: String, authenticatedApiClient: AuthenticatedApiClient): OperationsHomeRepository =
        HttpOperationsHomeRepository(authenticatedApiClient.retrofit(baseUrl).create(OperationsHomeApi::class.java))

    fun metricCatalogRepository(isDebug: Boolean, baseUrl: String): MetricCatalogRepository =
        if (canUseHttpRepository(isDebug, baseUrl)) {
            HttpMetricCatalogRepository(
                Retrofit.Builder()
                    .baseUrl(baseUrl)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build()
                    .create(ImportApi::class.java)
            )
        } else {
            UnavailableMetricCatalogRepository()
        }

    fun metricCatalogRepository(baseUrl: String, authenticatedApiClient: AuthenticatedApiClient): MetricCatalogRepository =
        HttpMetricCatalogRepository(authenticatedApiClient.retrofit(baseUrl).create(ImportApi::class.java))
}

class UnavailableOperationsRepository : OperationsRepository {
    override suspend fun loadReadiness(
        storeId: String,
        rangeStart: String,
        rangeEnd: String
    ): DataReadiness = unavailable()

    override suspend fun loadDeterministicDiagnostic(
        storeId: String,
        rangeStart: String,
        rangeEnd: String
    ): DeterministicDiagnostic? = unavailable()

    override suspend fun loadDiagnosticRun(
        storeId: String,
        diagnosticRunId: String
    ): DiagnosticRunDetail = unavailable()

    override suspend fun loadActionCards(storeId: String, status: String?): List<ActionCard> = unavailable()

    override suspend fun loadVerificationSummary(
        storeId: String,
        actionCardId: String
    ): ActionVerificationSummary? = unavailable()

    override suspend fun updateActionCard(
        storeId: String,
        actionCardId: String,
        update: ActionCardUpdate
    ): ActionCard = unavailable()

    private fun unavailable(): Nothing = throw OperationsServiceUnavailableException()
}
