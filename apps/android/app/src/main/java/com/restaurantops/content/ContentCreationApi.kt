package com.restaurantops.content

import com.google.gson.Gson
import com.restaurantops.auth.AuthenticatedApiClient
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path

interface ContentCreationWireApi {
    @GET("v1/stores/{store}/content-tasks")
    suspend fun listTasks(@Path("store") storeId: String): ContentTaskListWireDto

    @GET("v1/stores/{store}/content-tasks/{task}")
    suspend fun loadTask(@Path("store") storeId: String, @Path("task") taskId: String): ContentTaskDetailWireDto

    @POST("v1/stores/{store}/content-tasks")
    suspend fun createTask(@Path("store") storeId: String, @Body request: CreateContentTaskWireRequest): CreatedContentTaskWireDto

    @POST("v1/stores/{store}/content-tasks/{task}/topics/generate")
    suspend fun generateTopics(@Path("store") storeId: String, @Path("task") taskId: String): List<ContentTopicWireDto>

    @POST("v1/stores/{store}/content-tasks/{task}/topics/{topic}/copies/generate")
    suspend fun generateCopies(@Path("store") storeId: String, @Path("task") taskId: String, @Path("topic") topicId: String): List<ContentCopyWireDto>

    @PUT("v1/stores/{store}/content-tasks/{task}/copies/{copy}")
    suspend fun updateCopy(@Path("store") storeId: String, @Path("task") taskId: String, @Path("copy") copyId: String, @Body request: UpdateContentCopyWireRequest): ContentCopyWireDto

    @POST("v1/stores/{store}/content-tasks/{task}/copies/{copy}/confirm")
    suspend fun confirmCopy(@Path("store") storeId: String, @Path("task") taskId: String, @Path("copy") copyId: String): Response<ContentCopyWireDto>

    @POST("v1/stores/{store}/content-tasks/{task}/shots/generate")
    suspend fun generateShots(@Path("store") storeId: String, @Path("task") taskId: String): ContentShotListWireDto
}

fun contentCreationWireApi(client: AuthenticatedApiClient, baseUrl: String): ContentCreationWireApi =
    client.retrofit(baseUrl).create(ContentCreationWireApi::class.java)

data class ContentTaskListWireDto(val tasks: List<ContentTaskSummaryWireDto>?)
data class ContentTaskSummaryWireDto(val id: String?, val status: String?, val confirmedCopyId: String?, val createdAt: String?)
data class CreatedContentTaskWireDto(val id: String?, val profileVersion: Int?, val primaryGoal: String?, val status: String?)
data class ContentTaskDetailWireDto(
    val id: String?, val status: String?, val topics: List<ContentTopicWireDto>?, val copies: List<ContentCopyWireDto>?,
    val reviewFindings: List<ContentReviewFindingWireDto>?, val shotList: ContentShotListWireDto?
)
data class ContentTopicWireDto(
    val id: String?, val title: String?, val angle: String?, val productReference: String?, val goalReference: String?, val commercialLevel: Int?
)
data class ContentCopyWireDto(
    val id: String?, val topicId: String?, val title: String?, val body: String?, val strategy: String?,
    val productReference: String?, val goalReference: String?, val commercialLevel: Int?, val version: Int?, val status: String?
)
data class ContentReviewFindingWireDto(val copyId: String?, val pattern: String?, val severity: String?, val guidance: String?, val source: String?)
data class ContentShotListWireDto(val id: String?, val copyId: String?, val status: String?, val shots: List<ContentShotWireDto>?)
data class ContentShotWireDto(
    val order: Int?, val shot: String?, val durationSeconds: Int?, val narration: String?,
    val productReference: String?, val goalReference: String?, val commercialLevel: Int?
)
data class CreateContentTaskWireRequest(val persona: String, val contentType: String, val style: String, val commercialLevel: Int, val inspiration: String?)
data class UpdateContentCopyWireRequest(val title: String, val body: String)
private data class ConfirmationFailureWireDto(val findings: List<ContentReviewFindingWireDto>?)

fun contentTaskListFrom(dto: ContentTaskListWireDto): List<ContentTaskSummary> =
    dto.tasks?.map(::contentTaskSummaryFrom) ?: throw invalidContentResponse()

fun contentTaskDetailFrom(dto: ContentTaskDetailWireDto): ContentTaskDetail {
    val topics = dto.topics?.map(::contentTopicFrom) ?: throw invalidContentResponse()
    val copies = dto.copies?.map(::contentCopyFrom) ?: throw invalidContentResponse()
    validateRestoredCopyGroups(topics, copies)
    return ContentTaskDetail(
        id = requiredContentId(dto.id), status = requiredContentText(dto.status), topics = topics, copies = copies,
        reviewFindings = dto.reviewFindings?.map(::contentReviewFindingFrom) ?: throw invalidContentResponse(),
        shotList = dto.shotList?.let(::contentShotListFrom)
    )
}

fun generatedCopiesFrom(dtos: List<ContentCopyWireDto>): List<ContentCopy> {
    val copies = dtos.map(::contentCopyFrom)
    if (copies.size != 3 || copies.map { it.strategy.trim() }.toSet().size != 3) {
        throw ContentCreationRequestException("Generated copy options are invalid")
    }
    return copies
}

fun generatedTopicsFrom(dtos: List<ContentTopicWireDto>): List<ContentTopic> {
    val topics = dtos.map(::contentTopicFrom)
    if (topics.size != 3) throw ContentCreationRequestException("Generated topic options are invalid")
    return topics
}

private fun validateRestoredCopyGroups(topics: List<ContentTopic>, copies: List<ContentCopy>) {
    val topicIds = topics.map { it.id }.toSet()
    if (copies.any { it.topicId !in topicIds }) throw invalidContentResponse()
    copies.groupBy { it.topicId }.values.forEach { group ->
        if (group.size != 3 || group.map { it.strategy.trim() }.toSet().size != 3) throw invalidContentResponse()
    }
}

internal fun confirmationResultFrom(response: Response<ContentCopyWireDto>, gson: Gson = Gson()): CopyConfirmationResult = when {
    response.isSuccessful -> CopyConfirmationResult.Confirmed(contentCopyFrom(response.body() ?: throw invalidContentResponse()))
    response.code() == 422 -> CopyConfirmationResult.RevisionRequired(revisionFindingsFrom(response, gson))
    else -> throw ContentCreationRequestException("Unable to confirm the content copy", response.code())
}

private fun revisionFindingsFrom(response: Response<ContentCopyWireDto>, gson: Gson): List<ContentReviewFinding> = try {
    val body = response.errorBody()?.string() ?: throw invalidContentResponse()
    val failure = gson.fromJson(body, ConfirmationFailureWireDto::class.java) ?: throw invalidContentResponse()
    failure.findings?.map(::contentReviewFindingFrom) ?: throw invalidContentResponse()
} catch (error: ContentCreationRequestException) {
    throw error
} catch (_: Exception) {
    throw invalidContentResponse()
}

internal fun contentTaskSummaryFrom(dto: ContentTaskSummaryWireDto) = ContentTaskSummary(
    requiredContentId(dto.id), requiredContentText(dto.status), dto.confirmedCopyId?.takeIf { it.isNotBlank() }, requiredContentText(dto.createdAt)
)
internal fun createdContentTaskFrom(dto: CreatedContentTaskWireDto) = CreatedContentTask(
    requiredContentId(dto.id), dto.profileVersion?.takeIf { it > 0 } ?: throw invalidContentResponse(), requiredContentText(dto.primaryGoal), requiredContentText(dto.status)
)
internal fun contentTopicFrom(dto: ContentTopicWireDto) = ContentTopic(
    requiredContentId(dto.id), requiredContentText(dto.title), requiredContentText(dto.angle), requiredContentText(dto.productReference),
    requiredContentText(dto.goalReference), commercialLevelFrom(dto.commercialLevel)
)
internal fun contentCopyFrom(dto: ContentCopyWireDto) = ContentCopy(
    requiredContentId(dto.id), requiredContentId(dto.topicId), requiredContentText(dto.title), requiredContentText(dto.body),
    requiredContentText(dto.strategy), requiredContentText(dto.productReference), requiredContentText(dto.goalReference),
    commercialLevelFrom(dto.commercialLevel), dto.version?.takeIf { it > 0 } ?: throw invalidContentResponse(), requiredContentText(dto.status)
)
internal fun contentReviewFindingFrom(dto: ContentReviewFindingWireDto) = ContentReviewFinding(
    requiredContentId(dto.copyId), requiredContentText(dto.pattern), requiredContentText(dto.severity), requiredContentText(dto.guidance), requiredContentText(dto.source)
)
internal fun contentShotListFrom(dto: ContentShotListWireDto) = ContentShotList(
    requiredContentId(dto.id), requiredContentId(dto.copyId), requiredContentText(dto.status),
    dto.shots?.map(::contentShotFrom) ?: throw invalidContentResponse()
)
private fun contentShotFrom(dto: ContentShotWireDto) = ContentShot(
    dto.order?.takeIf { it > 0 } ?: throw invalidContentResponse(), requiredContentText(dto.shot),
    dto.durationSeconds?.takeIf { it > 0 } ?: throw invalidContentResponse(), requiredContentText(dto.narration),
    requiredContentText(dto.productReference), requiredContentText(dto.goalReference), commercialLevelFrom(dto.commercialLevel)
)
private fun commercialLevelFrom(value: Int?) = value?.takeIf { it in 0..3 } ?: throw invalidContentResponse()
private fun requiredContentId(value: String?) = value?.trim()?.takeIf { it.isNotEmpty() } ?: throw invalidContentResponse()
private fun requiredContentText(value: String?) = value?.trim()?.takeIf { it.isNotEmpty() } ?: throw invalidContentResponse()
private fun invalidContentResponse() = ContentCreationRequestException("Content response is invalid")
