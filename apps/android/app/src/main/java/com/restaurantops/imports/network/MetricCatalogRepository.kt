package com.restaurantops.imports.network

data class MetricCatalog(
    val versionNumber: Int,
    val definitions: List<MetricDefinition>
)

data class MetricDefinition(
    val metricKey: String,
    val displayName: String,
    val valueKind: String,
    val storageUnit: String,
    val usableForReadiness: Boolean,
    val usableForDiagnostic: Boolean,
    val usableForVerification: Boolean
)

interface MetricCatalogRepository {
    suspend fun loadMetricCatalog(storeId: String): MetricCatalog
}

class HttpMetricCatalogRepository(private val api: ImportApi) : MetricCatalogRepository {
    override suspend fun loadMetricCatalog(storeId: String): MetricCatalog = try {
        api.loadMetricCatalog(storeId).toDomain()
    } catch (error: retrofit2.HttpException) {
        throw ImportRequestException(error.code(), error.apiErrorMessage(), error)
    } catch (error: java.io.IOException) {
        throw ImportRequestException(0, "Unable to reach the import service", error)
    }
}

class UnavailableMetricCatalogRepository : MetricCatalogRepository {
    override suspend fun loadMetricCatalog(storeId: String): MetricCatalog {
        throw ImportRequestException(503, "指标目录服务暂不可用")
    }
}

private fun MetricCatalogResponse.toDomain() = MetricCatalog(
    versionNumber = versionNumber,
    definitions = definitions.map { definition -> MetricDefinition(
        metricKey = definition.metricKey,
        displayName = definition.displayName,
        valueKind = definition.valueKind,
        storageUnit = definition.storageUnit,
        usableForReadiness = definition.usableForReadiness,
        usableForDiagnostic = definition.usableForDiagnostic,
        usableForVerification = definition.usableForVerification
    ) }
)
