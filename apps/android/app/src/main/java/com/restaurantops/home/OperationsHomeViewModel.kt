package com.restaurantops.home

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.restaurantops.operations.ActionCard
import com.restaurantops.operations.ActionCardStatus
import com.restaurantops.operations.DataReadiness
import com.restaurantops.operations.DeterministicDiagnostic
import com.restaurantops.operations.OperationsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant

sealed interface OperationsHomeState {
    data object Loading : OperationsHomeState
    data object MissingData : OperationsHomeState
    data class Current(
        val period: ConfirmedOperationsPeriod,
        val readiness: DataReadiness,
        val diagnostic: DeterministicDiagnostic?,
        val actionCards: List<ActionCard>
    ) : OperationsHomeState
    data class Stale(
        val period: ConfirmedOperationsPeriod,
        val readiness: DataReadiness,
        val diagnostic: DeterministicDiagnostic?,
        val actionCards: List<ActionCard>
    ) : OperationsHomeState
    data class Failure(val message: String, val retryable: Boolean = true) : OperationsHomeState
}

class OperationsHomeViewModel(
    private val periodRepository: OperationsHomeRepository,
    private val operationsRepository: OperationsRepository,
    private val scope: CoroutineScope? = null,
    private val now: () -> Instant = Instant::now
) : ViewModel() {
    var state by mutableStateOf<OperationsHomeState>(OperationsHomeState.Loading)
        private set

    private var loadGeneration = 0L

    private val operationScope: CoroutineScope
        get() = scope ?: viewModelScope

    fun load(storeId: String) {
        val generation = ++loadGeneration
        state = OperationsHomeState.Loading
        operationScope.launch {
            try {
                val period = periodRepository.loadLatestConfirmedPeriod(storeId)
                if (generation != loadGeneration) return@launch
                if (period == null) {
                    state = OperationsHomeState.MissingData
                    return@launch
                }
                val snapshot = coroutineScope {
                    val readiness = async {
                        operationsRepository.loadReadiness(storeId, period.rangeStart, period.rangeEnd)
                    }
                    val diagnostic = async {
                        operationsRepository.loadDeterministicDiagnostic(storeId, period.rangeStart, period.rangeEnd)
                    }
                    val cards = async { operationsRepository.loadActionCards(storeId) }
                    OperationsHomeSnapshot(
                        readiness.await(),
                        diagnostic.await(),
                        cards.await().filter { card ->
                            (card.status == ActionCardStatus.PROPOSED || card.status == ActionCardStatus.IN_PROGRESS) &&
                                card.rangeStart == period.rangeStart && card.rangeEnd == period.rangeEnd
                        }
                    )
                }
                if (generation != loadGeneration) return@launch
                state = if (Duration.between(Instant.parse(period.confirmedAt), now()).toDays() > STALE_AFTER_DAYS) {
                    OperationsHomeState.Stale(period, snapshot.readiness, snapshot.diagnostic, snapshot.actionCards)
                } else {
                    OperationsHomeState.Current(period, snapshot.readiness, snapshot.diagnostic, snapshot.actionCards)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: OperationsHomeRequestException) {
                if (generation == loadGeneration) state = OperationsHomeState.Failure(LOAD_FAILURE_MESSAGE)
            } catch (_: Throwable) {
                if (generation == loadGeneration) state = OperationsHomeState.Failure(LOAD_FAILURE_MESSAGE)
            }
        }
    }

    private data class OperationsHomeSnapshot(
        val readiness: DataReadiness,
        val diagnostic: DeterministicDiagnostic?,
        val actionCards: List<ActionCard>
    )

    private companion object {
        const val STALE_AFTER_DAYS = 30L
        const val LOAD_FAILURE_MESSAGE = "运营数据暂时无法加载，请稍后重试"
    }
}
