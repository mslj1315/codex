package com.restaurantops.operations

import com.restaurantops.imports.network.MetricCatalogRepository
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.supervisorScope

class OperationsViewModel(
    private val repository: OperationsRepository,
    private val scope: CoroutineScope? = null,
    private val metricCatalogRepository: MetricCatalogRepository? = null
) : ViewModel() {
    var readiness by mutableStateOf<DataReadiness?>(null)
        private set
    var diagnostic by mutableStateOf<DeterministicDiagnostic?>(null)
        private set
    var actionCards by mutableStateOf<List<ActionCard>>(emptyList())
        private set
    var isLoading by mutableStateOf(false)
        private set
    var requestError by mutableStateOf<String?>(null)
        private set
    var isServiceUnavailable by mutableStateOf(false)
        private set
    var selectedActionCardId by mutableStateOf<String?>(null)
        private set
    var verificationSummary by mutableStateOf<ActionVerificationSummary?>(null)
        private set
    var selectedDiagnosticRun by mutableStateOf<DiagnosticRunDetail?>(null)
        private set
    var updatingActionCardId by mutableStateOf<String?>(null)
        private set
    var verificationMetricLabels by mutableStateOf<Map<String, String>>(emptyMap())
        private set
    var verificationMetricPresentations by mutableStateOf<Map<String, VerificationMetricPresentation>>(emptyMap())
        private set

    private val metricPresentationsByStore = mutableMapOf<String, Map<String, VerificationMetricPresentation>>()

    private val operationScope: CoroutineScope
        get() = scope ?: viewModelScope

    fun load(storeId: String, rangeStart: String, rangeEnd: String) {
        if (isLoading) return
        isLoading = true
        requestError = null
        isServiceUnavailable = false
        operationScope.launch {
            try {
                supervisorScope {
                    val readinessRequest = async { repository.loadReadiness(storeId, rangeStart, rangeEnd) }
                    val diagnosticRequest = async { repository.loadDeterministicDiagnostic(storeId, rangeStart, rangeEnd) }
                    val cardsRequest = async { repository.loadActionCards(storeId) }
                    val metricPresentationsRequest = async { loadMetricPresentations(storeId) }
                    val loadedReadiness = readinessRequest.await()
                    val loadedDiagnostic = diagnosticRequest.await()
                    val loadedActionCards = cardsRequest.await()
                    val loadedMetricPresentations = metricPresentationsRequest.await()

                    readiness = loadedReadiness
                    diagnostic = loadedDiagnostic
                    actionCards = loadedActionCards
                    verificationMetricPresentations = loadedMetricPresentations
                    verificationMetricLabels = loadedMetricPresentations.mapValues { (_, presentation) ->
                        "${presentation.displayName}（${presentation.storageUnit.displayUnit()}）"
                    }
                    selectedActionCardId = null
                    verificationSummary = null
                    selectedDiagnosticRun = null
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: OperationsServiceUnavailableException) {
                isServiceUnavailable = true
            } catch (error: OperationsRequestException) {
                requestError = neutralMessage(error)
            } catch (_: Throwable) {
                requestError = FAILURE_MESSAGE
            } finally {
                isLoading = false
            }
        }
    }

    fun loadVerificationSummary(storeId: String, actionCardId: String) {
        if (isLoading) return
        isLoading = true
        requestError = null
        isServiceUnavailable = false
        operationScope.launch {
            try {
                val loadedSummary = repository.loadVerificationSummary(storeId, actionCardId)
                selectedActionCardId = actionCardId
                verificationSummary = loadedSummary
            } catch (error: CancellationException) {
                throw error
            } catch (_: OperationsServiceUnavailableException) {
                isServiceUnavailable = true
            } catch (error: OperationsRequestException) {
                requestError = neutralMessage(error)
            } catch (_: Throwable) {
                requestError = FAILURE_MESSAGE
            } finally {
                isLoading = false
            }
        }
    }

    fun loadActionCardDetails(storeId: String, card: ActionCard) {
        if (isLoading) return
        isLoading = true
        requestError = null
        isServiceUnavailable = false
        selectedDiagnosticRun = null
        operationScope.launch {
            try {
                val loadedSummary = repository.loadVerificationSummary(storeId, card.id)
                selectedActionCardId = card.id
                verificationSummary = loadedSummary
                if (card.diagnosticRunId != null) {
                    selectedDiagnosticRun = repository.loadDiagnosticRun(storeId, card.diagnosticRunId)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: OperationsServiceUnavailableException) {
                selectedDiagnosticRun = null
                isServiceUnavailable = true
            } catch (error: OperationsRequestException) {
                selectedDiagnosticRun = null
                requestError = neutralMessage(error)
            } catch (_: Throwable) {
                selectedDiagnosticRun = null
                requestError = FAILURE_MESSAGE
            } finally {
                isLoading = false
            }
        }
    }

    fun updateActionCard(storeId: String, actionCardId: String, update: ActionCardUpdate) {
        if (updatingActionCardId != null || isLoading) return
        updatingActionCardId = actionCardId
        requestError = null
        isServiceUnavailable = false
        operationScope.launch {
            try {
                val updatedCard = repository.updateActionCard(storeId, actionCardId, update)
                actionCards = actionCards.map { card ->
                    if (card.id == updatedCard.id) updatedCard else card
                }
                if (selectedActionCardId == updatedCard.id) {
                    selectedActionCardId = null
                    verificationSummary = null
                    selectedDiagnosticRun = null
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: OperationsServiceUnavailableException) {
                isServiceUnavailable = true
            } catch (error: OperationsRequestException) {
                requestError = neutralMessage(error)
            } catch (_: Throwable) {
                requestError = FAILURE_MESSAGE
            } finally {
                updatingActionCardId = null
            }
        }
    }

    private fun neutralMessage(error: OperationsRequestException): String =
        if (error.statusCode == 0) CONNECTION_FAILURE_MESSAGE else FAILURE_MESSAGE

    private suspend fun loadMetricPresentations(storeId: String): Map<String, VerificationMetricPresentation> {
        metricPresentationsByStore[storeId]?.let { return it }
        val catalog = metricCatalogRepository ?: return emptyMap()
        return try {
            catalog.loadMetricCatalog(storeId).definitions
                .associate { definition ->
                    definition.metricKey to VerificationMetricPresentation(
                        displayName = definition.displayName,
                        storageUnit = definition.storageUnit
                    )
                }
                .also { presentations -> metricPresentationsByStore[storeId] = presentations }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            emptyMap()
        }
    }

    private companion object {
        const val CONNECTION_FAILURE_MESSAGE = "无法连接运营服务，请稍后重试"
        const val FAILURE_MESSAGE = "运营数据暂时无法加载，请稍后重试"
    }
}

internal fun String.displayUnit(): String = when (this) {
    "cents" -> "元"
    "count" -> "次"
    "basis_points" -> "%"
    else -> this
}
