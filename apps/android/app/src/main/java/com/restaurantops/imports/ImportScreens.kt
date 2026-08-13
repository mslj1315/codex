package com.restaurantops.imports

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.restaurantops.imports.files.ImportFileRules
import com.restaurantops.imports.network.ImportUnitBoundary
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportScreen(viewModel: ImportViewModel, storeId: String, onBack: () -> Unit) {
    var revenueInput by rememberSaveable { mutableStateOf("48260") }
    var averageSpendInput by rememberSaveable { mutableStateOf("38") }
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let { viewModel.selectFile(it.toString(), viewModel.selectedSource) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("导入经营数据") },
                navigationIcon = {
                    TextButton(onClick = onBack, enabled = viewModel.canRunCommands) { Text("返回") }
                }
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
            Text("经营报表导入", style = MaterialTheme.typography.titleMedium)
            if (viewModel.isLoading) {
                Text("正在处理...", color = MaterialTheme.colorScheme.primary)
            }
            SourcePicker(
                selectedSource = viewModel.selectedSource,
                onSelectSource = { source ->
                    if (source == ImportSourceType.MANUAL) {
                        viewModel.selectSource(source)
                    } else {
                        if (source != viewModel.selectedSource) viewModel.selectSource(source)
                        fileLauncher.launch(ImportFileRules.pickerMimeTypes(source))
                    }
                },
                enabled = viewModel.canRunCommands
            )

            when (viewModel.selectedSource) {
                ImportSourceType.MANUAL -> ManualEntry(
                    revenueInput = revenueInput,
                    averageSpendInput = averageSpendInput,
                    onRevenueChanged = { revenueInput = it },
                    onAverageSpendChanged = { averageSpendInput = it },
                    enabled = viewModel.canRunCommands,
                    onCreateSummary = {
                        viewModel.createManualImport(
                            storeId,
                            localManualDraft(revenueInput, averageSpendInput)
                        )
                    },
                    requestError = viewModel.requestError
                )
                ImportSourceType.CSV, ImportSourceType.XLSX -> FileImportCard(
                    source = viewModel.selectedSource,
                    selectedFile = viewModel.selectedFile,
                    enabled = viewModel.canRunCommands,
                    selectionError = viewModel.fileSelectionError,
                    requestError = viewModel.requestError,
                    uploadMessage = viewModel.fileUploadMessage,
                    onChooseFile = {
                        fileLauncher.launch(ImportFileRules.pickerMimeTypes(viewModel.selectedSource))
                    },
                    onUpload = { rangeStart, rangeEnd ->
                        viewModel.uploadSelectedFile(storeId, rangeStart, rangeEnd)
                    }
                )
            }

            viewModel.summary?.let { summary ->
                ImportSummaryContent(
                    summary = summary,
                    readyCount = viewModel.readyCandidateIds.size,
                    unresolvedCount = viewModel.unresolvedCandidateIds.size,
                    isReadOnly = viewModel.isReadOnly,
                    commandsEnabled = viewModel.canRunCommands,
                    confirmationMessage = viewModel.confirmationMessage,
                    onConfirmReady = { viewModel.confirmReady(storeId) },
                    onEditCandidate = { candidate, value, unit ->
                        viewModel.editCandidate(storeId, candidate.id, value, unit)
                    }
                )
            }
        }
    }
}

@Composable
private fun SourcePicker(
    selectedSource: ImportSourceType,
    onSelectSource: (ImportSourceType) -> Unit,
    enabled: Boolean
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("选择数据来源", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ImportSourceType.entries.forEach { source ->
                TextButton(onClick = { onSelectSource(source) }, enabled = enabled) {
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
    enabled: Boolean,
    onCreateSummary: () -> Unit,
    requestError: String?
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
                enabled = enabled,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = averageSpendInput,
                onValueChange = onAverageSpendChanged,
                label = { Text("客单价（元）") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                enabled = enabled,
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = onCreateSummary, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                Text("生成待确认项")
            }
            requestError?.let { InlineMessage(it, isError = true) }
        }
    }
}

@Composable
private fun FileImportCard(
    source: ImportSourceType,
    selectedFile: PreparedImportFile?,
    enabled: Boolean,
    selectionError: String?,
    requestError: String?,
    uploadMessage: String?,
    onChooseFile: () -> Unit,
    onUpload: (String, String) -> Unit
) {
    var rangeStart by rememberSaveable(source) { mutableStateOf("2026-08-01") }
    var rangeEnd by rememberSaveable(source) { mutableStateOf("2026-08-07") }
    val datePattern = Regex("\\d{4}-\\d{2}-\\d{2}")
    val canUpload = selectedFile != null &&
        rangeStart.matches(datePattern) &&
        rangeEnd.matches(datePattern) &&
        enabled

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(sourceLabel(source), style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(
                value = rangeStart,
                onValueChange = { rangeStart = it },
                label = { Text("开始日期") },
                placeholder = { Text("YYYY-MM-DD") },
                enabled = enabled,
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = rangeEnd,
                onValueChange = { rangeEnd = it },
                label = { Text("结束日期") },
                placeholder = { Text("YYYY-MM-DD") },
                enabled = enabled,
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            TextButton(onClick = onChooseFile, enabled = enabled) {
                Text(if (selectedFile == null) "选择文件" else "重新选择")
            }
            selectedFile?.let { file ->
                Text(
                    file.displayName,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodyLarge
                )
                Text(
                    humanFileSize(file.sizeBytes),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            selectionError?.let { InlineMessage(it, isError = true) }
            requestError?.let { InlineMessage(it, isError = true) }
            uploadMessage?.let { InlineMessage(it, isError = false) }
            Button(
                onClick = { onUpload(rangeStart, rangeEnd) },
                enabled = canUpload,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("上传并解析")
            }
        }
    }
}

@Composable
private fun InlineMessage(message: String, isError: Boolean) {
    Text(
        message,
        color = if (isError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
    )
}

private fun humanFileSize(sizeBytes: Long): String = when {
    sizeBytes >= 1024 * 1024 -> String.format(Locale.US, "%.1f MiB", sizeBytes / (1024.0 * 1024.0))
    sizeBytes >= 1024 -> String.format(Locale.US, "%.1f KiB", sizeBytes / 1024.0)
    else -> "$sizeBytes B"
}

@Composable
private fun ImportSummaryContent(
    summary: ImportSummary,
    readyCount: Int,
    unresolvedCount: Int,
    isReadOnly: Boolean,
    commandsEnabled: Boolean,
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
                enabled = readyCount > 0 && !isReadOnly && commandsEnabled,
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
                commandsEnabled = commandsEnabled,
                onSave = onEditCandidate
            )
        }
    }
}

@Composable
private fun CandidateCard(candidate: ImportCandidate) {
    val displayValue = ImportUnitBoundary.displayValue(candidate.metricKey, candidate.value, candidate.unit)
    val displayUnit = ImportUnitBoundary.displayUnit(candidate.metricKey, candidate.unit)
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(candidate.metricDisplayName, style = MaterialTheme.typography.titleSmall)
            Text("$displayValue $displayUnit · 置信度 ${candidate.confidence}%")
        }
    }
}

@Composable
private fun EditableCandidateCard(
    candidate: ImportCandidate,
    isReadOnly: Boolean,
    commandsEnabled: Boolean,
    onSave: (ImportCandidate, Long, String) -> Unit
) {
    var valueInput by rememberSaveable(candidate.id) {
        mutableStateOf(ImportUnitBoundary.displayValue(candidate.metricKey, candidate.value, candidate.unit))
    }
    var unitInput by rememberSaveable(candidate.id) {
        mutableStateOf(ImportUnitBoundary.displayInputUnit(candidate.metricKey, candidate.unit))
    }
    val parsedInput = ImportUnitBoundary.parseDisplayInput(candidate.metricKey, valueInput, unitInput)

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
                    label = { Text("确认数值（${ImportUnitBoundary.displayUnit(candidate.metricKey, candidate.unit)}）") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    enabled = commandsEnabled,
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = unitInput,
                    onValueChange = { unitInput = it },
                    label = { Text("确认单位：yuan / cents / count / times") },
                    singleLine = true,
                    enabled = commandsEnabled,
                    modifier = Modifier.fillMaxWidth()
                )
                Button(
                    onClick = { parsedInput?.let { onSave(candidate, it.value, it.unit) } },
                    enabled = commandsEnabled && parsedInput != null,
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
                unit = "yuan",
                confidence = 100,
                status = ImportCandidateStatus.READY
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

    override suspend fun createFileImport(storeId: String, draft: FileImportDraft): FileImportResult {
        throw com.restaurantops.imports.network.ImportRequestException(503, "文件上传服务暂不可用")
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
