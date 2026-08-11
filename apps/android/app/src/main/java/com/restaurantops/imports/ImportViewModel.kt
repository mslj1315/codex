package com.restaurantops.imports

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.restaurantops.imports.network.ImportRequestException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

class ImportViewModel(
    private val repository: ImportRepository,
    private val scope: CoroutineScope? = null
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

    private var isConfirmed by mutableStateOf(false)

    private val operationScope: CoroutineScope
        get() = scope ?: viewModelScope

    val isReadOnly: Boolean
        get() = isConfirmed

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
        selectedSource = sourceType
        confirmationMessage = null
        requestError = null
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
        val CONFIRMABLE_UNITS = setOf("yuan", "cents", "count", "times")
        const val FORBIDDEN_STATUS = 403
        const val CONFLICT_STATUS = 409
        const val TRANSPORT_STATUS = 0
        const val CONNECTION_FAILURE_MESSAGE = "连接服务失败，请稍后重试"
    }
}
