package com.restaurantops.content

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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.util.Locale

enum class ContentCreationAccessAction { ReturnToLogin }

enum class ContentCreationDestination { RemoteWorkflow, RemoteRequired }

fun contentCreationDestination(hasAuthenticatedClient: Boolean): ContentCreationDestination =
    if (hasAuthenticatedClient) ContentCreationDestination.RemoteWorkflow else ContentCreationDestination.RemoteRequired

data class ContentCreationWorkspaceAction(val label: String, val enabled: Boolean, private val callback: () -> Unit) {
    fun invoke() = callback()
}

fun contentCreationWorkspaceActions(
    state: ContentCreationState,
    onGenerateTopics: () -> Unit
): List<ContentCreationWorkspaceAction> = when (state.stage) {
    ContentCreationStage.Idle -> listOf(ContentCreationWorkspaceAction("生成选题", !state.finalizing, onGenerateTopics))
    else -> emptyList()
}

data class ContentCreationRouteAction(val label: String, private val callback: () -> Unit) {
    fun invoke() = callback()
}

data class RemoteContentCreationRequiredRoute(val actions: List<ContentCreationRouteAction>)

fun remoteContentCreationRequiredRoute(onReturnToLogin: () -> Unit): RemoteContentCreationRequiredRoute =
    RemoteContentCreationRequiredRoute(listOf(ContentCreationRouteAction("返回登录", onReturnToLogin)))

enum class ContentCreationScreenMode { Queue, Creating, TopicSelection, ThreeCopies, ReviewBlocked, Confirmed, StoryboardHandoff }

fun contentCreationScreenMode(state: ContentCreationState): ContentCreationScreenMode = when {
    state.creationSheetOpen -> ContentCreationScreenMode.Creating
    state.stage == ContentCreationStage.TopicSelection -> ContentCreationScreenMode.TopicSelection
    state.stage == ContentCreationStage.CopyEditing -> ContentCreationScreenMode.ThreeCopies
    state.stage == ContentCreationStage.RevisionRequired -> ContentCreationScreenMode.ReviewBlocked
    state.stage == ContentCreationStage.Confirmed -> ContentCreationScreenMode.Confirmed
    state.stage == ContentCreationStage.StoryboardReady -> ContentCreationScreenMode.StoryboardHandoff
    else -> ContentCreationScreenMode.Queue
}

fun contentCreationAccessActions(hasAuthenticatedClient: Boolean): List<ContentCreationAccessAction> =
    if (hasAuthenticatedClient) emptyList() else listOf(ContentCreationAccessAction.ReturnToLogin)

@Composable
fun RemoteContentCreationRequiredScreen(
    onReturnToLogin: () -> Unit,
    modifier: Modifier = Modifier
) {
    val route = remoteContentCreationRequiredRoute(onReturnToLogin)
    Column(
        modifier = modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("内容创作", style = MaterialTheme.typography.titleLarge)
        Text("请登录客户账号后使用内容创作。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = route.actions.single()::invoke) { Text(route.actions.single().label) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContentCreationScreen(
    viewModel: ContentCreationViewModel,
    storeId: String,
    onStoryboardHandoff: (ContentStoryboardHandoff) -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.state.collectAsState()
    LaunchedEffect(storeId) { viewModel.load(storeId) }

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("内容创作", style = MaterialTheme.typography.titleLarge)
        Text("创建选题、选择文案并生成确认后的分镜。抖音作品仍由客户手动发布。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        state.error?.let { NeutralContentError(onRetry = { viewModel.load(storeId) }) }
        if (!state.loaded && !state.finalizing) {
            Text("正在加载内容任务…", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        ContentQueue(
            tasks = state.tasks,
            usageSummary = state.usageSummary,
            enabled = !state.finalizing,
            onSelect = { task -> viewModel.restore(storeId, task.id) },
            onCreate = viewModel::openCreationSheet
        )
        state.task?.let { task ->
            HorizontalDivider()
            ContentTaskWorkspace(
                state = state,
                task = task,
                onSelectTopic = viewModel::selectTopic,
                onGenerateTopics = { viewModel.generateTopics(storeId) },
                onGenerateCopies = { viewModel.generateCopies(storeId) },
                onSelectCopy = viewModel::selectCopy,
                onDraftChanged = viewModel::updateSelectedDraft,
                onSaveCopy = { viewModel.saveSelectedCopy(storeId) },
                onConfirmCopy = { viewModel.confirmSelectedCopy(storeId) },
                onGenerateShots = { viewModel.generateShots(storeId) },
                onStoryboardHandoff = onStoryboardHandoff
            )
        }
    }

    if (state.creationSheetOpen) {
        ContentCreationSheet(
            input = state.creationInput,
            submitting = state.finalizing,
            pendingTopicGeneration = state.pendingTopicGenerationTaskId != null,
            onInputChange = viewModel::updateCreationInput,
            onDismiss = viewModel::dismissCreationSheet,
            onSubmit = { viewModel.createAndGenerateTopics(storeId) }
        )
    }
}

@Composable
private fun ContentQueue(
    tasks: List<ContentTaskSummary>,
    usageSummary: CustomerUsageSummary?,
    enabled: Boolean,
    onSelect: (ContentTaskSummary) -> Unit,
    onCreate: () -> Unit
) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text("进行中的任务", style = MaterialTheme.typography.titleMedium)
        Button(onClick = onCreate, enabled = enabled) { Text("新建") }
    }
    usageSummary?.let { summary ->
        Text(customerUsageSummaryLabel(summary), color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
    }
    if (tasks.isEmpty()) {
        Text("暂无内容任务，创建一个任务开始生成选题。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        tasks.groupBy { it.status }.forEach { (status, group) ->
            Text(contentTaskStatusLabel(status), style = MaterialTheme.typography.labelLarge)
            group.forEach { task ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    TextButton(onClick = { onSelect(task) }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("内容任务", style = MaterialTheme.typography.titleSmall)
                            Text("状态：${contentTaskStatusLabel(task.status)}")
                            Text("创建于 ${task.createdAt}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

fun customerUsageSummaryLabel(summary: CustomerUsageSummary): String =
    "本月 ${summary.totalTokens} Token · ${summary.successCount} 次成功调用 · 预估 ¥${String.format(Locale.US, "%.2f", summary.estimatedCostCny)}"

@Composable
private fun ContentTaskWorkspace(
    state: ContentCreationState,
    task: ContentTaskDetail,
    onSelectTopic: (String) -> Unit,
    onGenerateTopics: () -> Unit,
    onGenerateCopies: () -> Unit,
    onSelectCopy: (String) -> Unit,
    onDraftChanged: (String, String) -> Unit,
    onSaveCopy: () -> Unit,
    onConfirmCopy: () -> Unit,
    onGenerateShots: () -> Unit,
    onStoryboardHandoff: (ContentStoryboardHandoff) -> Unit
) {
    when (state.stage) {
        ContentCreationStage.Idle -> {
            Text("任务尚未生成选题。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            contentCreationWorkspaceActions(state, onGenerateTopics).single().let { action ->
                Button(onClick = action::invoke, enabled = action.enabled) { Text(action.label) }
            }
        }
        ContentCreationStage.TopicSelection -> TopicSelection(
            topics = task.topics,
            selectedTopicId = state.selectedTopicId,
            working = state.finalizing,
            onSelect = onSelectTopic,
            onGenerateCopies = onGenerateCopies
        )
        ContentCreationStage.CopyEditing, ContentCreationStage.RevisionRequired -> CopyEditor(
            state = state,
            copies = task.copies.filter { it.topicId == state.selectedTopicId },
            onSelectCopy = onSelectCopy,
            onDraftChanged = onDraftChanged,
            onSave = onSaveCopy,
            onConfirm = onConfirmCopy
        )
        ContentCreationStage.Confirmed -> {
            Text("文案已确认，可以生成分镜。", style = MaterialTheme.typography.titleMedium)
            Button(onClick = onGenerateShots, enabled = !state.finalizing) { Text("生成分镜") }
        }
        ContentCreationStage.StoryboardReady -> {
            Text("分镜已生成，可以开始素材剪辑。", style = MaterialTheme.typography.titleMedium)
            state.storyboardHandoff?.let { handoff ->
                Button(onClick = { onStoryboardHandoff(handoff) }, enabled = !state.finalizing) { Text("进入分镜剪辑") }
            }
        }
    }
}

@Composable
private fun TopicSelection(
    topics: List<ContentTopic>,
    selectedTopicId: String?,
    working: Boolean,
    onSelect: (String) -> Unit,
    onGenerateCopies: () -> Unit
) {
    Text("选择一个选题", style = MaterialTheme.typography.titleMedium)
    topics.forEach { topic ->
        Card(modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = { onSelect(topic.id) }, enabled = !working, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(topic.title, style = MaterialTheme.typography.titleSmall)
                    Text(topic.angle, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (topic.id == selectedTopicId) Text("已选择")
                }
            }
        }
    }
    Button(onClick = onGenerateCopies, enabled = !working && selectedTopicId != null) { Text("生成 3 版文案") }
}

@Composable
private fun CopyEditor(
    state: ContentCreationState,
    copies: List<ContentCopy>,
    onSelectCopy: (String) -> Unit,
    onDraftChanged: (String, String) -> Unit,
    onSave: () -> Unit,
    onConfirm: () -> Unit
) {
    val selected = copies.firstOrNull { it.id == state.selectedCopyId }
    Text("选择并编辑文案", style = MaterialTheme.typography.titleMedium)
    copies.forEach { copy ->
        Card(modifier = Modifier.fillMaxWidth()) {
            TextButton(onClick = { onSelectCopy(copy.id) }, enabled = !state.finalizing, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(copy.strategy, style = MaterialTheme.typography.labelLarge)
                    Text(copy.title, style = MaterialTheme.typography.titleSmall)
                    if (copy.id == selected?.id) Text("当前编辑")
                }
            }
        }
    }
    if (state.stage == ContentCreationStage.RevisionRequired) {
        Text("审核要求修改后再确认", color = MaterialTheme.colorScheme.error)
        state.reviewFindings.forEach { finding -> Text(finding.guidance, color = MaterialTheme.colorScheme.error) }
    }
    selected?.let { copy -> CopyDraftFields(copy, state.finalizing, onDraftChanged, onSave, onConfirm, state.stage == ContentCreationStage.CopyEditing) }
}

@Composable
private fun CopyDraftFields(
    copy: ContentCopy,
    working: Boolean,
    onDraftChanged: (String, String) -> Unit,
    onSave: () -> Unit,
    onConfirm: () -> Unit,
    canConfirm: Boolean
) {
    var title by remember(copy.id, copy.title) { mutableStateOf(copy.title) }
    var body by remember(copy.id, copy.body) { mutableStateOf(copy.body) }
    OutlinedTextField(value = title, onValueChange = { title = it; onDraftChanged(it, body) }, enabled = !working, label = { Text("标题") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(value = body, onValueChange = { body = it; onDraftChanged(title, it) }, enabled = !working, label = { Text("文案") }, modifier = Modifier.fillMaxWidth(), minLines = 4)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = onSave, enabled = !working && title.isNotBlank() && body.isNotBlank()) { Text("保存") }
        Button(onClick = onConfirm, enabled = !working && canConfirm && title.isNotBlank() && body.isNotBlank()) { Text("确认文案") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ContentCreationSheet(
    input: ContentCreationInput,
    submitting: Boolean,
    pendingTopicGeneration: Boolean,
    onInputChange: (ContentCreationInput) -> Unit,
    onDismiss: () -> Unit,
    onSubmit: () -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(if (pendingTopicGeneration) "继续生成选题" else "新建内容任务", style = MaterialTheme.typography.titleLarge)
            if (!pendingTopicGeneration) {
                ContentInputField("人设", input.persona, submitting) { onInputChange(input.copy(persona = it)) }
                ContentInputField("内容类型", input.contentType, submitting) { onInputChange(input.copy(contentType = it)) }
                ContentInputField("表达风格", input.style, submitting) { onInputChange(input.copy(style = it)) }
                ContentInputField("客户灵感（可选）", input.inspiration, submitting) { onInputChange(input.copy(inspiration = it)) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    (0..3).forEach { level ->
                        TextButton(onClick = { onInputChange(input.copy(commercialLevel = level)) }, enabled = !submitting) {
                            Text(if (level == input.commercialLevel) "商业度 $level ✓" else "商业度 $level")
                        }
                    }
                }
            }
            Button(
                onClick = onSubmit,
                enabled = !submitting && contentCreationCanSubmit(input, pendingTopicGeneration),
                modifier = Modifier.fillMaxWidth()
            ) { Text(if (pendingTopicGeneration) "重试生成选题" else "创建并生成选题") }
        }
    }
}

@Composable
private fun ContentInputField(label: String, value: String, disabled: Boolean, onValueChange: (String) -> Unit) {
    OutlinedTextField(value = value, onValueChange = onValueChange, enabled = !disabled, label = { Text(label) }, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun NeutralContentError(onRetry: () -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("暂时无法完成内容操作", color = MaterialTheme.colorScheme.error)
        TextButton(onClick = onRetry) { Text("重试") }
    }
}

fun contentTaskStatusLabel(status: String): String = when (status.lowercase()) {
    "draft" -> "待完善"
    "confirmed" -> "已确认"
    "storyboard_ready", "generated" -> "分镜已生成"
    else -> "进行中"
}

fun contentCreationCanSubmit(input: ContentCreationInput, pendingTopicGeneration: Boolean): Boolean =
    pendingTopicGeneration || (input.persona.isNotBlank() && input.contentType.isNotBlank() && input.style.isNotBlank())
