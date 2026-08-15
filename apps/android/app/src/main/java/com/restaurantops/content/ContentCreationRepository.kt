package com.restaurantops.content

import java.io.IOException
import retrofit2.HttpException

interface ContentCreationApi {
    suspend fun listTasks(storeId: String): List<ContentTaskSummary>
    suspend fun loadTask(storeId: String, taskId: String): ContentTaskDetail
    suspend fun createTask(storeId: String, request: CreateContentTaskRequest): CreatedContentTask
    suspend fun generateTopics(storeId: String, taskId: String): List<ContentTopic>
    suspend fun generateCopies(storeId: String, taskId: String, topicId: String): List<ContentCopy>
    suspend fun updateCopy(storeId: String, taskId: String, copyId: String, request: UpdateContentCopyRequest): ContentCopy
    suspend fun confirmCopy(storeId: String, taskId: String, copyId: String): CopyConfirmationResult
    suspend fun generateShots(storeId: String, taskId: String): ContentShotList
}

class HttpContentCreationRepository(private val wire: ContentCreationWireApi) : ContentCreationApi {
    override suspend fun listTasks(storeId: String) = call { contentTaskListFrom(wire.listTasks(requiredId(storeId))) }
    override suspend fun loadTask(storeId: String, taskId: String) = call { contentTaskDetailFrom(wire.loadTask(requiredId(storeId), requiredId(taskId))) }
    override suspend fun createTask(storeId: String, request: CreateContentTaskRequest) = call {
        validateCreateRequest(request)
        createdContentTaskFrom(wire.createTask(requiredId(storeId), CreateContentTaskWireRequest(request.persona.trim(), request.contentType.trim(), request.style.trim(), request.commercialLevel, request.inspiration?.trim()?.takeIf { it.isNotEmpty() })))
    }
    override suspend fun generateTopics(storeId: String, taskId: String) = call { generatedTopicsFrom(wire.generateTopics(requiredId(storeId), requiredId(taskId))) }
    override suspend fun generateCopies(storeId: String, taskId: String, topicId: String) = call { generatedCopiesFrom(wire.generateCopies(requiredId(storeId), requiredId(taskId), requiredId(topicId))) }
    override suspend fun updateCopy(storeId: String, taskId: String, copyId: String, request: UpdateContentCopyRequest) = call {
        if (request.title.isBlank() || request.body.isBlank()) throw ContentCreationRequestException("Content request is invalid")
        contentCopyFrom(wire.updateCopy(requiredId(storeId), requiredId(taskId), requiredId(copyId), UpdateContentCopyWireRequest(request.title.trim(), request.body.trim())))
    }
    override suspend fun confirmCopy(storeId: String, taskId: String, copyId: String) = call {
        confirmationResultFrom(wire.confirmCopy(requiredId(storeId), requiredId(taskId), requiredId(copyId)))
    }
    override suspend fun generateShots(storeId: String, taskId: String) = call {
        contentShotListFrom(wire.generateShots(requiredId(storeId), requiredId(taskId)))
    }

    private suspend fun <T> call(block: suspend () -> T): T = try {
        block()
    } catch (error: ContentCreationRequestException) {
        throw error
    } catch (error: HttpException) {
        throw ContentCreationRequestException("Unable to complete the content request", error.code())
    } catch (_: IOException) {
        throw ContentCreationRequestException("Unable to reach the content service")
    } catch (_: Exception) {
        throw ContentCreationRequestException("Unable to complete the content request")
    }
}

private fun requiredId(value: String) = value.trim().takeIf { it.isNotEmpty() } ?: throw ContentCreationRequestException("Content request is invalid")
private fun validateCreateRequest(request: CreateContentTaskRequest) {
    if (request.persona.isBlank() || request.contentType.isBlank() || request.style.isBlank() || request.commercialLevel !in 0..3) {
        throw ContentCreationRequestException("Content request is invalid")
    }
}
