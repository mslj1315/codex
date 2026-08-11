package com.restaurantops.imports.network

import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

interface ImportApi {
    @POST("/v1/stores/{storeId}/imports/manual")
    suspend fun createManualImport(
        @Path("storeId") storeId: String,
        @Body request: ManualImportRequest
    ): ImportBatchResponse

    @GET("/v1/stores/{storeId}/imports/{batchId}")
    suspend fun loadImport(
        @Path("storeId") storeId: String,
        @Path("batchId") batchId: String
    ): ImportBatchResponse

    @PATCH("/v1/stores/{storeId}/imports/{batchId}/candidates/{candidateId}")
    suspend fun updateCandidate(
        @Path("storeId") storeId: String,
        @Path("batchId") batchId: String,
        @Path("candidateId") candidateId: String,
        @Body request: CandidateUpdateRequest
    ): ImportCandidateResponse

    @POST("/v1/stores/{storeId}/imports/{batchId}/confirm")
    suspend fun confirm(
        @Path("storeId") storeId: String,
        @Path("batchId") batchId: String,
        @Body request: ConfirmImportRequest
    ): FactVersionResponse

    @GET("/v1/stores/{storeId}/facts/latest")
    suspend fun latestFacts(
        @Path("storeId") storeId: String
    ): FactVersionResponse
}

data class ManualImportRequest(
    val rangeStart: String,
    val rangeEnd: String,
    val candidates: List<ManualCandidateRequest>
)

data class ManualCandidateRequest(
    val metricKey: String,
    val metricDisplayName: String,
    val value: Long,
    val unit: String,
    val rangeStart: String? = null,
    val rangeEnd: String? = null,
    val sourceLocator: String? = null,
    val confidence: Int? = null,
    val status: String? = null
)

data class CandidateUpdateRequest(
    val value: Long? = null,
    val unit: String? = null,
    val rangeStart: String? = null,
    val rangeEnd: String? = null,
    val status: String? = null
)

data class ConfirmImportRequest(
    val candidateIds: List<String>
)

data class ImportBatchResponse(
    val id: String,
    val sourceType: String,
    val status: String,
    val rangeStart: String?,
    val rangeEnd: String?,
    val candidates: List<ImportCandidateResponse>
)

data class ImportCandidateResponse(
    val id: String,
    val metricKey: String,
    val metricDisplayName: String,
    val value: Long,
    val unit: String,
    val confidence: Int,
    val status: String,
    val issueCode: String?,
    val rangeStart: String,
    val rangeEnd: String,
    val sourceLocator: String?
)

data class FactVersionResponse(
    val id: String,
    val sourceBatchId: String,
    val confirmationStatus: String,
    val values: List<FactValueResponse>
)

data class FactValueResponse(
    val id: String,
    val metricKey: String,
    val value: Long,
    val unit: String,
    val rangeStart: String,
    val rangeEnd: String,
    val sourceCandidateId: String
)
