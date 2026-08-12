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

    private val operationScope: CoroutineScope
        get() = scope ?: viewModelScope

    fun load(storeId: String, rangeStart: String, rangeEnd: String) {
        if (isLoading) return
        isLoading = true
        requestError = null
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
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: OperationsRequestException) {
                requestError = if (error.statusCode == 0) {
                    CONNECTION_FAILURE_MESSAGE
                } else {
                    FAILURE_MESSAGE
                }
            } catch (_: Throwable) {
                requestError = FAILURE_MESSAGE
            } finally {
                isLoading = false
            }
        }
    }

    private companion object {
        const val CONNECTION_FAILURE_MESSAGE = "Unable to reach the operations service"
        const val FAILURE_MESSAGE = "Unable to load operations data"
    }
}
