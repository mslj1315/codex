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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
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
    DiagnosticContent(
        diagnostic = viewModel.diagnostic,
        comparisonAvailable = viewModel.readiness?.comparisonAvailable,
        presentations = viewModel.verificationMetricPresentations
    )
    ActionCardsContent(
        cards = viewModel.actionCards,
        selectedActionCardId = viewModel.selectedActionCardId,
        selectedDiagnosticRun = viewModel.selectedDiagnosticRun,
        onSelect = { viewModel.loadActionCardDetails(storeId, it) },
        onUpdate = { actionCardId, update -> viewModel.updateActionCard(storeId, actionCardId, update) },
        updatingActionCardId = viewModel.updatingActionCardId,
        verificationMetricLabels = viewModel.verificationMetricLabels,
        verificationMetricPresentations = viewModel.verificationMetricPresentations
    )
    viewModel.verificationSummary?.let { summary ->
        VerificationSummaryContent(summary, viewModel.verificationMetricPresentations)
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
    comparisonAvailable: Boolean?,
    presentations: Map<String, VerificationMetricPresentation>
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
                    Text(
                        "规则版本：${diagnostic.ruleVersion}",
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    diagnostic.evidence.forEach { evidence -> Text(formatDiagnosticEvidence(evidence, presentations)) }
                }
            }
        }
    }
}

@Composable
private fun ActionCardsContent(
    cards: List<ActionCard>,
    selectedActionCardId: String?,
    selectedDiagnosticRun: DiagnosticRunDetail?,
    onSelect: (ActionCard) -> Unit,
    onUpdate: (String, ActionCardUpdate) -> Unit,
    updatingActionCardId: String?,
    verificationMetricLabels: Map<String, String>,
    verificationMetricPresentations: Map<String, VerificationMetricPresentation>
) {
    Text("行动卡", style = MaterialTheme.typography.titleMedium)
    if (cards.isEmpty()) {
        Text("当前没有行动卡。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    cards.forEach { card ->
        ActionCardContent(
            card = card,
            selected = selectedActionCardId == card.id,
            isUpdating = updatingActionCardId == card.id,
            verificationMetricLabels = verificationMetricLabels,
            onSelect = { onSelect(card) },
            onUpdate = { onUpdate(card.id, it) }
        )
        if (selectedActionCardId == card.id && card.diagnosticRunId != null && selectedDiagnosticRun != null) {
            RecordedDiagnosticEvidenceContent(selectedDiagnosticRun, verificationMetricPresentations)
        }
    }
}

@Composable
private fun ActionCardContent(
    card: ActionCard,
    selected: Boolean,
    isUpdating: Boolean,
    verificationMetricLabels: Map<String, String>,
    onSelect: () -> Unit,
    onUpdate: (ActionCardUpdate) -> Unit
) {
    val commands = card.status.nextCommands()
    var executionNote by rememberSaveable(card.id) { mutableStateOf("") }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(card.title, style = MaterialTheme.typography.titleSmall)
            verificationMetricKeysText(card.verificationMetricKeys, verificationMetricLabels)?.let { metricKeys ->
                Text(metricKeys, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text("状态：${card.status.name.lowercase()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (card.diagnosticRunId != null) {
                Text("来源：已关联记录证据", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            card.executionNote?.let { Text("执行说明：$it") }
            card.verificationOutcome?.let { Text("复盘结果：${it.name.lowercase()}") }
            if (card.status.canViewVerificationSummary()) {
                TextButton(onClick = onSelect, enabled = !isUpdating) {
                    Text(if (selected) "已选择" else "查看验证")
                }
            }
            if (ActionCardCommand.START in commands) {
                TextButton(onClick = { onUpdate(ActionCardUpdate.start()) }, enabled = !isUpdating) {
                    Text("开始执行")
                }
            }
            if (ActionCardCommand.CANCEL in commands) {
                TextButton(onClick = { onUpdate(ActionCardUpdate.cancel()) }, enabled = !isUpdating) {
                    Text("取消")
                }
            }
            if (ActionCardCommand.COMPLETE in commands) {
                OutlinedTextField(
                    value = executionNote,
                    onValueChange = { executionNote = it.take(500) },
                    label = { Text("执行说明") },
                    enabled = !isUpdating,
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth()
                )
                TextButton(
                    onClick = { onUpdate(ActionCardUpdate.completed(executionNote.trim())) },
                    enabled = !isUpdating && isValidExecutionNote(executionNote)
                ) {
                    Text("完成执行")
                }
            }
            if (ActionCardCommand.VERIFY in commands) {
                ActionCardVerificationOutcome.entries.forEach { outcome ->
                    TextButton(onClick = { onUpdate(ActionCardUpdate.verified(outcome)) }, enabled = !isUpdating) {
                        Text(outcome.name.lowercase())
                    }
                }
            }
        }
    }
}

internal fun verificationMetricKeysText(
    metricKeys: List<String>,
    labels: Map<String, String> = emptyMap()
): String? = metricKeys.takeIf { it.isNotEmpty() }?.joinToString(
    prefix = "验证指标：",
    separator = "、"
) { metricKey -> labels[metricKey] ?: metricKey }

@Composable
private fun VerificationSummaryContent(
    summary: ActionVerificationSummary,
    presentations: Map<String, VerificationMetricPresentation>
) {
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
                Text(formatVerificationMetric(metric, presentations), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

internal fun formatVerificationMetric(
    metric: VerificationMetric,
    presentations: Map<String, VerificationMetricPresentation> = emptyMap()
): String {
    val presentation = presentations[metric.metricKey]
    val displayName = presentation?.displayName ?: metric.metricKey
    val baseline = formatVerificationValue(metric.baselineValue, presentation?.storageUnit)
    val comparison = formatVerificationValue(metric.comparisonValue, presentation?.storageUnit)
    val unit = presentation?.storageUnit?.displayUnit().orEmpty()
    val suffix = when (unit) {
        "" -> ""
        "%" -> "%"
        else -> " $unit"
    }
    return "$displayName：基线 $baseline$suffix，对比 $comparison$suffix，变化 ${metric.changePercent}%"
}

private fun formatVerificationValue(value: Long, storageUnit: String?): String = when (storageUnit) {
    "cents", "basis_points" -> {
        val whole = value / 100
        val fraction = kotlin.math.abs(value % 100)
        val sign = if (value < 0 && whole == 0L) "-" else ""
        if (fraction == 0L) whole.toString() else "$sign$whole.${fraction.toString().padStart(2, '0')}"
    }
    else -> value.toString()
}

@Composable
private fun RecordedDiagnosticEvidenceContent(
    detail: DiagnosticRunDetail,
    presentations: Map<String, VerificationMetricPresentation>
) {
    Text("已记录诊断依据", style = MaterialTheme.typography.titleSmall)
    Text(detail.kind)
    Text("规则版本：${detail.ruleVersion}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text("置信度：${detail.confidence.name.lowercase()}", color = MaterialTheme.colorScheme.onSurfaceVariant)
    detail.evidence.forEach { evidence -> Text(formatDiagnosticEvidence(evidence, presentations)) }
}

internal enum class ActionCardCommand { START, COMPLETE, VERIFY, CANCEL }

internal fun ActionCardStatus.nextCommands(): Set<ActionCardCommand> = when (this) {
    ActionCardStatus.PROPOSED -> setOf(ActionCardCommand.START, ActionCardCommand.CANCEL)
    ActionCardStatus.IN_PROGRESS -> setOf(ActionCardCommand.COMPLETE, ActionCardCommand.CANCEL)
    ActionCardStatus.COMPLETED -> setOf(ActionCardCommand.VERIFY)
    ActionCardStatus.VERIFIED, ActionCardStatus.CANCELLED -> emptySet()
}

internal fun ActionCardStatus.canViewVerificationSummary(): Boolean =
    this == ActionCardStatus.COMPLETED || this == ActionCardStatus.VERIFIED

internal fun isValidExecutionNote(note: String): Boolean =
    note.trim().isNotEmpty() && note.length <= 500

internal fun formatDiagnosticEvidence(
    evidence: DiagnosticEvidence,
    presentations: Map<String, VerificationMetricPresentation> = emptyMap()
): String {
    val presentation = presentations[evidence.metricKey]
    val displayName = presentation?.displayName ?: evidence.metricKey
    val current = formatVerificationValue(evidence.currentValue, presentation?.storageUnit)
    val prior = formatVerificationValue(evidence.priorValue, presentation?.storageUnit)
    val unit = presentation?.storageUnit?.displayUnit().orEmpty()
    val suffix = when (unit) {
        "" -> ""
        "%" -> "%"
        else -> " $unit"
    }
    return "$displayName：当前 $current$suffix，前期 $prior$suffix，变化 ${evidence.changePercent}%"
}
