package com.restaurantops.operations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun OperationsScreen(
    viewModel: OperationsViewModel,
    storeId: String,
    rangeStart: String,
    rangeEnd: String,
    modifier: Modifier = Modifier
) {
    LaunchedEffect(storeId, rangeStart, rangeEnd) {
        viewModel.load(storeId, rangeStart, rangeEnd)
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("运营工作台", style = MaterialTheme.typography.titleLarge)
            IconButton(
                onClick = { viewModel.load(storeId, rangeStart, rangeEnd) },
                enabled = !viewModel.isLoading
            ) {
                Icon(
                    imageVector = Icons.Filled.Refresh,
                    contentDescription = "刷新运营数据"
                )
            }
        }

        when {
            viewModel.isServiceUnavailable -> UnavailableContent()
            else -> OperationsContent(viewModel, storeId)
        }
    }
}

@Composable
private fun UnavailableContent() {
    Text("运营服务尚未配置", style = MaterialTheme.typography.titleMedium)
    Text(
        "当前不会生成或展示示例经营结论。请在可用的独立运营服务环境中查看数据。",
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

@Composable
private fun OperationsContent(viewModel: OperationsViewModel, storeId: String) {
    if (viewModel.isLoading) {
        Text("正在加载运营数据...", color = MaterialTheme.colorScheme.primary)
    }
    viewModel.requestError?.let { error ->
        Text(error, color = MaterialTheme.colorScheme.error)
    }
    viewModel.readiness?.let { readiness ->
        ReadinessCard(readiness)
    }
    DiagnosticContent(viewModel.diagnostic, viewModel.readiness?.comparisonAvailable)
    ActionCardsContent(
        cards = viewModel.actionCards,
        selectedActionCardId = viewModel.selectedActionCardId,
        onSelect = { viewModel.loadVerificationSummary(storeId, it) }
    )
    viewModel.verificationSummary?.let { summary ->
        VerificationSummaryContent(summary)
    }
}

@Composable
private fun ReadinessCard(readiness: DataReadiness) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text("数据就绪度", style = MaterialTheme.typography.titleMedium)
            Text("置信度：${readiness.confidence.name.lowercase()}")
            Text(if (readiness.comparisonAvailable) "可进行周期比较" else "暂不可进行周期比较")
            if (readiness.missingMetrics.isNotEmpty()) {
                Text(
                    "缺少指标：${readiness.missingMetrics.joinToString()}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun DiagnosticContent(
    diagnostic: DeterministicDiagnostic?,
    comparisonAvailable: Boolean?
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text("确定性诊断", style = MaterialTheme.typography.titleMedium)
            when {
                comparisonAvailable == false -> Text("需要完整的已确认可比数据后才能生成诊断。")
                diagnostic == null -> Text("当前周期没有确定性诊断结论。")
                else -> {
                    Text(diagnostic.kind)
                    Text(
                        "置信度：${diagnostic.confidence.name.lowercase()}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }
}

@Composable
private fun ActionCardsContent(
    cards: List<ActionCard>,
    selectedActionCardId: String?,
    onSelect: (String) -> Unit
) {
    Text("行动卡", style = MaterialTheme.typography.titleMedium)
    if (cards.isEmpty()) {
        Text("当前没有行动卡。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    cards.forEach { card ->
        Card(modifier = Modifier.fillMaxWidth()) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(card.title, style = MaterialTheme.typography.titleSmall)
                    Text("状态：${card.status}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { onSelect(card.id) }) {
                    Text(if (selectedActionCardId == card.id) "已选择" else "查看验证")
                }
            }
        }
    }
}

@Composable
private fun VerificationSummaryContent(summary: ActionVerificationSummary) {
    Text("验证摘要", style = MaterialTheme.typography.titleMedium)
    if (summary.metrics.isEmpty()) {
        Text("当前没有可用的验证数据。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    summary.metrics.forEach { metric ->
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text(metric.metricKey, style = MaterialTheme.typography.titleSmall)
                Text("基线：${metric.baselineValue}，对比：${metric.comparisonValue}")
                Text("变化：${metric.changePercent}%", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
