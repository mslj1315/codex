package com.restaurantops.operations

import com.restaurantops.imports.network.LocalImportApiRuntime
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
