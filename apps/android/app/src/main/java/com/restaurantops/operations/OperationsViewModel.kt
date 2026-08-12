package com.restaurantops.operations

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
    private val scope: CoroutineScope? = null
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
                    val loadedReadiness = readinessRequest.await()
                    val loadedDiagnostic = diagnosticRequest.await()
                    val loadedActionCards = cardsRequest.await()

                    readiness = loadedReadiness
                    diagnostic = loadedDiagnostic
                    actionCards = loadedActionCards
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

    private companion object {
        const val CONNECTION_FAILURE_MESSAGE = "Unable to reach the operations service"
        const val FAILURE_MESSAGE = "Unable to load operations data"
    }
}
