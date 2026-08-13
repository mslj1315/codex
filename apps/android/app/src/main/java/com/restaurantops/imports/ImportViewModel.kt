package com.restaurantops.imports

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.restaurantops.imports.files.ImportFileReader
import com.restaurantops.imports.network.ImportRequestException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

private object UnavailableImportFileReader : ImportFileReader {
    override suspend fun read(uri: String, sourceType: ImportSourceType): PreparedImportFile =
        throw ImportRequestException(422, "文件选择尚未启用")
}

class ImportViewModel(
    private val repository: ImportRepository,
    private val scope: CoroutineScope? = null,
    private val fileReader: ImportFileReader = UnavailableImportFileReader
) : ViewModel() {
    var summary by mutableStateOf<ImportSummary?>(null)
        private set

    var selectedSource by mutableStateOf(ImportSourceType.MANUAL)
        private set

    var confirmationMessage by mutableStateOf<String?>(null)
        private set

    var isLoading by mutableStateOf(false)
        private set

    var requestError by mutableStateOf<String?>(null)
        private set

    var selectedFile by mutableStateOf<PreparedImportFile?>(null)
        private set

    var fileSelectionError by mutableStateOf<String?>(null)
        private set

    var fileUploadMessage by mutableStateOf<String?>(null)
        private set

    private var isConfirmed by mutableStateOf(false)

    private val operationScope: CoroutineScope
        get() = scope ?: viewModelScope

    val isReadOnly: Boolean
        get() = isConfirmed

    val canRunCommands: Boolean
        get() = !isLoading

    val readyCandidateIds: List<String>
        get() = if (isConfirmed) emptyList() else summary?.candidates.orEmpty()
            .filter { it.status == ImportCandidateStatus.READY }
            .map { it.id }

    val unresolvedCandidateIds: List<String>
        get() = summary?.candidates.orEmpty()
            .filter { it.status == ImportCandidateStatus.NEEDS_CONFIRMATION }
            .map { it.id }

    fun load(storeId: String, importId: String) {
        if (!beginRequest()) return
        operationScope.launch {
            try {
                applySummary(repository.loadImport(storeId, importId))
            } catch (error: Throwable) {
                showRequestError(error)
            } finally {
                isLoading = false
            }
        }
    }

    fun selectSource(sourceType: ImportSourceType) {
        if (isLoading) return
        if (selectedSource != sourceType) {
            selectedFile = null
            summary = null
            isConfirmed = false
        }
        selectedSource = sourceType
        confirmationMessage = null
        requestError = null
        fileSelectionError = null
        fileUploadMessage = null
    }

    fun selectFile(uri: String, sourceType: ImportSourceType) {
        if (sourceType == ImportSourceType.MANUAL || !beginRequest()) return
        selectedSource = sourceType
        selectedFile = null
        summary = null
        isConfirmed = false
        fileSelectionError = null
        fileUploadMessage = null
        operationScope.launch {
            try {
                selectedFile = fileReader.read(uri, sourceType)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                fileSelectionError = if (error is ImportRequestException) {
                    error.message ?: FILE_READ_FAILURE_MESSAGE
                } else {
                    FILE_READ_FAILURE_MESSAGE
                }
            } finally {
                isLoading = false
            }
        }
    }

    fun uploadSelectedFile(storeId: String, rangeStart: String, rangeEnd: String) {
        val file = selectedFile ?: return
        if (!beginRequest()) return
        fileSelectionError = null
        operationScope.launch {
            try {
                val result = repository.createFileImport(
                    storeId,
                    FileImportDraft(rangeStart = rangeStart, rangeEnd = rangeEnd, file = file)
                )
                applySummary(result.summary)
                selectedFile = null
                fileUploadMessage = if (result.duplicate) DUPLICATE_FILE_MESSAGE else null
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                showRequestError(error)
            } finally {
                isLoading = false
            }
        }
    }

    fun createManualImport(storeId: String, draft: ManualImportDraft) {
        if (!beginRequest()) return
        operationScope.launch {
            try {
                applySummary(repository.createManualImport(storeId, draft))
                selectedSource = ImportSourceType.MANUAL
            } catch (error: Throwable) {
                showRequestError(error)
            } finally {
                isLoading = false
            }
        }
    }

    fun editCandidate(storeId: String, candidateId: String, value: Long, unit: String) {
        val currentSummary = summary ?: return
        val candidate = currentSummary.candidates.firstOrNull { it.id == candidateId } ?: return
        if (candidate.status != ImportCandidateStatus.NEEDS_CONFIRMATION || isConfirmed) return
        if (!beginRequest()) return
        val normalizedUnit = unit.trim().lowercase()
        val isResolved = value > 0 && normalizedUnit in CONFIRMABLE_UNITS
        operationScope.launch {
            try {
                applySummary(repository.updateCandidate(
                    storeId = storeId,
                    importId = currentSummary.id,
                    candidateId = candidateId,
                    update = ImportCandidateUpdate(
                        value = value,
                        unit = normalizedUnit,
                        status = if (isResolved) ImportCandidateStatus.READY else ImportCandidateStatus.NEEDS_CONFIRMATION
                    )
                ))
            } catch (error: ImportRequestException) {
                if (error.statusCode == CONFLICT_STATUS) {
                    reloadAfterConflict(storeId, currentSummary.id)
                } else {
                    showRequestError(error)
                }
            } catch (error: Throwable) {
                showRequestError(error)
            } finally {
                isLoading = false
            }
        }
    }

    fun confirmReady(storeId: String) {
        val currentSummary = summary ?: return
        if (isConfirmed) return
        val candidateIds = readyCandidateIds
        if (candidateIds.isEmpty()) return
        if (!beginRequest()) return
        operationScope.launch {
            try {
                repository.confirm(storeId, currentSummary.id, candidateIds)
                applySummary(currentSummary.copy(status = ImportBatchStatus.CONFIRMED))
                confirmationMessage = "\u5df2\u751f\u6210\u786e\u8ba4\u6570\u636e\u7248\u672c"
            } catch (error: ImportRequestException) {
                if (error.statusCode == CONFLICT_STATUS) {
                    reloadAfterConflict(storeId, currentSummary.id)
                } else {
                    showRequestError(error)
                    isLoading = false
                }
            } catch (error: Throwable) {
                showRequestError(error)
                isLoading = false
            } finally {
                isLoading = false
            }
        }
    }

    private suspend fun reloadAfterConflict(storeId: String, importId: String) {
        try {
            applySummary(repository.loadImport(storeId, importId))
            requestError = "数据已发生变化，已刷新当前导入记录"
        } catch (error: Throwable) {
            showRequestError(error)
        } finally {
            isLoading = false
        }
    }

    private fun beginRequest(): Boolean {
        if (isLoading) return false
        isLoading = true
        requestError = null
        confirmationMessage = null
        fileUploadMessage = null
        return true
    }

    private fun applySummary(importSummary: ImportSummary) {
        summary = importSummary
        isConfirmed = importSummary.status == ImportBatchStatus.CONFIRMED
        confirmationMessage = null
    }

    private fun showRequestError(error: Throwable) {
        if (error is CancellationException) throw error
        requestError = when (error) {
            is ImportRequestException -> when (error.statusCode) {
                TRANSPORT_STATUS -> CONNECTION_FAILURE_MESSAGE
                FORBIDDEN_STATUS -> "本地开发门店上下文拒绝了该请求"
                else -> error.message ?: CONNECTION_FAILURE_MESSAGE
            }
            else -> CONNECTION_FAILURE_MESSAGE
        }
    }

    private companion object {
        val CONFIRMABLE_UNITS = setOf("yuan", "cents", "count")
        const val FORBIDDEN_STATUS = 403
        const val CONFLICT_STATUS = 409
        const val TRANSPORT_STATUS = 0
        const val CONNECTION_FAILURE_MESSAGE = "连接服务失败，请稍后重试"
        const val FILE_READ_FAILURE_MESSAGE = "无法读取所选文件"
        const val DUPLICATE_FILE_MESSAGE = "已打开此前导入的报表"
    }
}
