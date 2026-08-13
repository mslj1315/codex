package com.restaurantops.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.restaurantops.operations.ActionCard
import com.restaurantops.operations.DataReadiness
import com.restaurantops.operations.DeterministicDiagnostic

data class OperationsHomeUiModel(
    val message: String,
    val period: ConfirmedOperationsPeriod? = null,
    val readiness: DataReadiness? = null,
    val diagnostic: DeterministicDiagnostic? = null,
    val actionCards: List<ActionCard> = emptyList(),
    val importRequired: Boolean = false,
    val canViewOperations: Boolean = false,
    val canRetry: Boolean = false
) {
    val periodLabel: String?
        get() = period?.let { "${it.rangeStart} 至 ${it.rangeEnd}" }

    companion object {
        fun from(state: OperationsHomeState): OperationsHomeUiModel = when (state) {
            OperationsHomeState.Loading -> OperationsHomeUiModel(message = "正在加载已确认经营数据")
            OperationsHomeState.MissingData -> OperationsHomeUiModel(
                message = "暂无已确认经营数据，请先导入并确认一个经营周期。",
                importRequired = true
            )
            is OperationsHomeState.Current -> state.toUiModel("当前已确认经营周期")
            is OperationsHomeState.Stale -> state.toUiModel("最近确认数据已超过 30 天，建议先导入新数据。", importRequired = true)
            is OperationsHomeState.Failure -> OperationsHomeUiModel(message = state.message, canRetry = state.retryable)
        }

        private fun OperationsHomeState.Current.toUiModel(message: String, importRequired: Boolean = false) =
            OperationsHomeUiModel(message, period, readiness, diagnostic, actionCards, importRequired, true)

        private fun OperationsHomeState.Stale.toUiModel(message: String, importRequired: Boolean) =
            OperationsHomeUiModel(message, period, readiness, diagnostic, actionCards, importRequired, true)
    }
}

@Composable
fun OperationsHomeScreen(
    viewModel: OperationsHomeViewModel,
    storeId: String,
    onOpenImport: () -> Unit,
    onOpenOperations: (ConfirmedOperationsPeriod) -> Unit,
    modifier: Modifier = Modifier
) {
    LaunchedEffect(storeId) { viewModel.load(storeId) }
    val model = OperationsHomeUiModel.from(viewModel.state)
    Column(
        modifier = modifier.fillMaxSize().padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Text("今日经营", style = MaterialTheme.typography.titleLarge)
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(model.message, style = MaterialTheme.typography.titleMedium)
                model.periodLabel?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                model.readiness?.let { readiness ->
                    Text("数据置信度：${readiness.confidence.name.lowercase()}")
                    if (readiness.missingMetrics.isNotEmpty()) {
                        Text("待补指标：${readiness.missingMetrics.joinToString("、")}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                model.diagnostic?.let { diagnostic -> Text("经营诊断：${diagnostic.kind}") }
                if (model.actionCards.isNotEmpty()) {
                    Text("待办行动：${model.actionCards.size} 项")
                    model.actionCards.forEach { card -> Text(card.title, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                }
                if (model.importRequired) {
                    Button(onClick = onOpenImport) { Text("导入经营数据") }
                }
                model.period?.takeIf { model.canViewOperations }?.let { period ->
                    TextButton(onClick = { onOpenOperations(period) }) { Text("查看运营") }
                }
                if (model.canRetry) {
                    IconButton(onClick = { viewModel.load(storeId) }) {
                        Icon(Icons.Filled.Refresh, contentDescription = "重新加载经营数据")
                    }
                }
            }
        }
    }
}
