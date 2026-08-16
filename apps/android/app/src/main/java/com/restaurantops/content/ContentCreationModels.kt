package com.restaurantops.content

data class ContentTaskSummary(
    val id: String,
    val status: String,
    val confirmedCopyId: String?,
    val createdAt: String
)

data class CustomerUsageSummary(
    val periodStart: String,
    val periodEnd: String,
    val inputTokens: Int,
    val outputTokens: Int,
    val totalTokens: Int,
    val estimatedCostCny: Double,
    val callCount: Int,
    val successCount: Int,
    val unpricedCallCount: Int
)

data class CreatedContentTask(
    val id: String,
    val profileVersion: Int,
    val primaryGoal: String,
    val status: String
)

data class ContentTaskDetail(
    val id: String,
    val status: String,
    val topics: List<ContentTopic>,
    val copies: List<ContentCopy>,
    val reviewFindings: List<ContentReviewFinding>,
    val shotList: ContentShotList?
)

data class ContentTopic(
    val id: String,
    val title: String,
    val angle: String,
    val productReference: String,
    val goalReference: String,
    val commercialLevel: Int
)

data class ContentCopy(
    val id: String,
    val topicId: String,
    val title: String,
    val body: String,
    val strategy: String,
    val productReference: String,
    val goalReference: String,
    val commercialLevel: Int,
    val version: Int,
    val status: String
)

data class ContentReviewFinding(
    val copyId: String,
    val pattern: String,
    val severity: String,
    val guidance: String,
    val source: String
)

data class ContentShotList(
    val id: String,
    val copyId: String,
    val status: String,
    val shots: List<ContentShot>
)

data class ContentShot(
    val order: Int,
    val shot: String,
    val durationSeconds: Int,
    val narration: String,
    val productReference: String,
    val goalReference: String,
    val commercialLevel: Int
)

data class CreateContentTaskRequest(
    val persona: String,
    val contentType: String,
    val style: String,
    val commercialLevel: Int,
    val inspiration: String? = null
)

data class UpdateContentCopyRequest(val title: String, val body: String)

sealed interface CopyConfirmationResult {
    data class Confirmed(val copy: ContentCopy) : CopyConfirmationResult
    data class RevisionRequired(val findings: List<ContentReviewFinding>) : CopyConfirmationResult
}

class ContentCreationRequestException(
    message: String,
    val statusCode: Int = 0
) : RuntimeException(message)
