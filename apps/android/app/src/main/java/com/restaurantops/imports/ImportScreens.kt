package com.restaurantops.imports

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp

private const val LOCAL_STORE_ID = "store_demo"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(viewModel: ImportViewModel, onBack: () -> Unit) {
    var revenueInput by rememberSaveable { mutableStateOf("48260") }
    var averageSpendInput by rememberSaveable { mutableStateOf("38") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("导入经营数据") },
                navigationIcon = { TextButton(onClick = onBack) { Text("返回") } }
            )
        }
    ) { contentPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .padding(20.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            Text("本地演示导入", style = MaterialTheme.typography.titleMedium)
            Text(
                "当前仅在本机创建演示数据，不读取、上传或同步文件，也不会调用 AI、服务端或网络。",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            SourcePicker(
                selectedSource = viewModel.selectedSource,
                onSelectSource = viewModel::selectSource
            )

            when (viewModel.selectedSource) {
                ImportSourceType.MANUAL -> ManualEntry(
                    revenueInput = revenueInput,
                    averageSpendInput = averageSpendInput,
                    onRevenueChanged = { revenueInput = it },
                    onAverageSpendChanged = { averageSpendInput = it },
                    onCreateSummary = {
                        viewModel.createManualImport(
                            LOCAL_STORE_ID,
                            localManualDraft(revenueInput, averageSpendInput)
                        )
                    }
                )
                ImportSourceType.CSV, ImportSourceType.XLSX -> LocalFilePlaceholder(
                    source = viewModel.selectedSource
                )
            }

            viewModel.summary?.let { summary ->
                ImportSummaryContent(
                    summary = summary,
                    readyCount = viewModel.readyCandidateIds.size,
                    unresolvedCount = viewModel.unresolvedCandidateIds.size,
                    isReadOnly = viewModel.isReadOnly,
                    confirmationMessage = viewModel.confirmationMessage,
                    onConfirmReady = { viewModel.confirmReady(LOCAL_STORE_ID) },
                    onEditCandidate = { candidate, value, unit ->
                        viewModel.editCandidate(LOCAL_STORE_ID, candidate.id, value, unit)
                    }
                )
            }
        }
    }
}

@Composable
private fun SourcePicker(selectedSource: ImportSourceType, onSelectSource: (ImportSourceType) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("选择数据来源", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ImportSourceType.entries.forEach { source ->
                TextButton(onClick = { onSelectSource(source) }) {
                    val prefix = if (source == selectedSource) "已选：" else ""
                    Text(prefix + sourceLabel(source))
                }
            }
        }
    }
}

@Composable
private fun ManualEntry(
    revenueInput: String,
    averageSpendInput: String,
    onRevenueChanged: (String) -> Unit,
    onAverageSpendChanged: (String) -> Unit,
    onCreateSummary: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("手工录入", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = revenueInput,
                onValueChange = onRevenueChanged,
                label = { Text("营业额（元）") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = averageSpendInput,
                onValueChange = onAverageSpendChanged,
                label = { Text("客单价（元）") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = onCreateSummary, modifier = Modifier.fillMaxWidth()) {
                Text("生成本地待确认项")
            }
        }
    }
}

@Composable
private fun LocalFilePlaceholder(source: ImportSourceType) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(sourceLabel(source), style = MaterialTheme.typography.titleSmall)
            Text("该来源仅展示入口；本地演示不会选择、读取或上传文件。")
            Text("文件导入和服务端确认将在接入后启用。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ImportSummaryContent(
    summary: ImportSummary,
    readyCount: Int,
    unresolvedCount: Int,
    isReadOnly: Boolean,
    confirmationMessage: String?,
    onConfirmReady: () -> Unit,
    onEditCandidate: (ImportCandidate, Long, String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("导入概览", style = MaterialTheme.typography.titleSmall)
            Text("来源：${sourceLabel(summary.sourceType)} · ${summary.rangeStart} 至 ${summary.rangeEnd}")
            Text("可批量确认 $readyCount 项 · 待确认 $unresolvedCount 项")
            Button(
                onClick = onConfirmReady,
                enabled = readyCount > 0 && !isReadOnly,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("批量确认已就绪项（$readyCount）")
            }
            confirmationMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
        }
    }

    val readyCandidates = summary.candidates.filter { it.status == ImportCandidateStatus.READY }
    if (readyCandidates.isNotEmpty()) {
        Text("已就绪项", style = MaterialTheme.typography.titleSmall)
        readyCandidates.forEach { candidate ->
            CandidateCard(candidate = candidate)
        }
    }

    val unresolvedCandidates = summary.candidates.filter { it.status == ImportCandidateStatus.NEEDS_CONFIRMATION }
    if (unresolvedCandidates.isNotEmpty()) {
        Text("待确认项", style = MaterialTheme.typography.titleSmall)
        unresolvedCandidates.forEach { candidate ->
            EditableCandidateCard(
                candidate = candidate,
                isReadOnly = isReadOnly,
                onSave = onEditCandidate
            )
        }
    }
}

@Composable
private fun CandidateCard(candidate: ImportCandidate) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(candidate.metricDisplayName, style = MaterialTheme.typography.titleSmall)
            Text("${candidate.value} ${candidate.unit} · 置信度 ${candidate.confidence}%")
        }
    }
}

@Composable
private fun EditableCandidateCard(
    candidate: ImportCandidate,
    isReadOnly: Boolean,
    onSave: (ImportCandidate, Long, String) -> Unit
) {
    var valueInput by rememberSaveable(candidate.id) { mutableStateOf(candidate.value.toString()) }
    var unitInput by rememberSaveable(candidate.id) { mutableStateOf("") }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(candidate.metricDisplayName, style = MaterialTheme.typography.titleSmall)
            Text("待确认，尚未用于诊断", color = MaterialTheme.colorScheme.error)
            candidate.issueCode?.let { Text("待处理原因：$it", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (isReadOnly) {
                Text("该导入已确认，待确认项不可再编辑。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                OutlinedTextField(
                    value = valueInput,
                    onValueChange = { valueInput = it },
                    label = { Text("确认数值") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = unitInput,
                    onValueChange = { unitInput = it },
                    label = { Text("确认单位：yuan / cents / count / times") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = { onSave(candidate, valueInput.toLongOrNull() ?: 0L, unitInput) },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("保存并加入已就绪项")
                }
            }
        }
    }
}

private fun localManualDraft(revenueInput: String, averageSpendInput: String): ManualImportDraft {
    val revenueYuan = revenueInput.toLongOrNull()?.coerceAtLeast(0) ?: 0L
    val averageSpendYuan = averageSpendInput.toLongOrNull()?.coerceAtLeast(0) ?: 0L
    return ManualImportDraft(
        rangeStart = "2026-08-01",
        rangeEnd = "2026-08-07",
        candidates = listOf(
            ImportCandidate(
                id = "manual_revenue",
                metricKey = "revenue",
                metricDisplayName = "营业额",
                value = revenueYuan,
                unit = "yuan",
                confidence = 100,
                status = ImportCandidateStatus.READY
            ),
            ImportCandidate(
                id = "manual_average_spend",
                metricKey = "average_spend",
                metricDisplayName = "客单价",
                value = averageSpendYuan,
                unit = "unknown",
                confidence = 0,
                status = ImportCandidateStatus.NEEDS_CONFIRMATION,
                issueCode = "unit_missing"
            )
        )
    )
}

private fun sourceLabel(source: ImportSourceType): String = when (source) {
    ImportSourceType.CSV -> "CSV 文件"
    ImportSourceType.XLSX -> "Excel 文件"
    ImportSourceType.MANUAL -> "手工录入"
}

class LocalDemoImportRepository : ImportRepository {
    private var storedSummary: ImportSummary? = null

    override suspend fun loadImport(storeId: String, importId: String): ImportSummary =
        requireNotNull(storedSummary) { "本地演示中没有该导入记录" }

    override suspend fun createManualImport(storeId: String, draft: ManualImportDraft): ImportSummary {
        storedSummary = ImportSummary(
            id = "local_manual_import",
            sourceType = ImportSourceType.MANUAL,
            rangeStart = draft.rangeStart,
            rangeEnd = draft.rangeEnd,
            candidates = draft.candidates
        )
        return requireNotNull(storedSummary)
    }

    override suspend fun updateCandidate(
        storeId: String,
        importId: String,
        candidateId: String,
        update: ImportCandidateUpdate
    ): ImportSummary {
        val current = requireNotNull(storedSummary) { "本地演示中没有该导入记录" }
        storedSummary = current.copy(candidates = current.candidates.map { candidate ->
            if (candidate.id != candidateId) candidate else candidate.copy(
                value = update.value ?: candidate.value,
                unit = update.unit ?: candidate.unit,
                status = update.status ?: candidate.status
            )
        })
        return requireNotNull(storedSummary)
    }

    override suspend fun confirm(storeId: String, importId: String, candidateIds: List<String>): FactVersion =
        FactVersion("local_fact_version", importId, "confirmed")

    override suspend fun loadLatestFacts(storeId: String): FactVersion =
        FactVersion("local_fact_version", "local_manual_import", "confirmed")
}
