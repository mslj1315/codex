package com.restaurantops.workspace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.restaurantops.imports.ImportScreen
import com.restaurantops.imports.ImportViewModel
import com.restaurantops.imports.LocalDemoImportRepository
import com.restaurantops.BuildConfig
import com.restaurantops.imports.network.HttpImportRepository
import com.restaurantops.imports.network.ImportApi
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceRoot(
    viewModel: WorkspaceViewModel,
    onReturnToOnboarding: () -> Unit
) {
    val importViewModel = remember {
        val repository = if (BuildConfig.DEBUG) {
            val api = Retrofit.Builder()
                .baseUrl(BuildConfig.LOCAL_API_BASE_URL)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(ImportApi::class.java)
            HttpImportRepository(api)
        } else {
            LocalDemoImportRepository()
        }
        ImportViewModel(repository)
    }
    when {
        viewModel.isDiagnosisOpen -> DiagnosisScreen(
            onBack = viewModel::closeOverlay,
            onCreateTask = viewModel::createPriorityTaskAndOpenTasks
        )
        viewModel.isVideoFactoryOpen -> VideoFactoryScreen(
            stage = viewModel.videoStage,
            selectedTopic = viewModel.selectedTopic,
            copyDraft = viewModel.copyDraft,
            onSelectTopic = viewModel::selectTopic,
            onCopyDraftChanged = viewModel::updateCopyDraft,
            onPrevious = viewModel::retreatVideoStage,
            onNext = viewModel::advanceVideoStage,
            onClose = viewModel::closeOverlay,
            onReturnHome = {
                viewModel.selectTab(WorkspaceTab.HOME)
                viewModel.closeOverlay()
            }
        )
        viewModel.isImportOpen -> ImportScreen(
            viewModel = importViewModel,
            onBack = viewModel::closeOverlay
        )
        else -> Scaffold(
            topBar = { TopAppBar(title = { Text("今日经营") }) },
            bottomBar = {
                NavigationBar {
                    WorkspaceTab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = viewModel.selectedTab == tab,
                            onClick = { viewModel.selectTab(tab) },
                            icon = { Text(tab.title.take(1)) },
                            label = { Text(tab.title) }
                        )
                    }
                }
            }
        ) { contentPadding ->
            when (viewModel.selectedTab) {
                WorkspaceTab.HOME -> HomeScreen(
                    pendingTaskCount = viewModel.tasks.size,
                    onOpenDiagnosis = viewModel::openDiagnosis,
                    onCreateTask = {
                        viewModel.createPriorityTask()
                        viewModel.selectTab(WorkspaceTab.TASKS)
                    },
                    onViewAllAlerts = { viewModel.selectTab(WorkspaceTab.TASKS) },
                    onOpenVideoFactory = viewModel::openVideoFactory,
                    onOpenImport = viewModel::openImport,
                    modifier = Modifier.padding(contentPadding)
                )
                WorkspaceTab.TASKS -> TasksScreen(
                    tasks = viewModel.tasks,
                    modifier = Modifier.padding(contentPadding)
                )
                WorkspaceTab.MESSAGES -> LocalPlaceholderScreen(
                    title = "消息",
                    message = "本地演示暂无同步消息。连接服务后才会显示团队通知。",
                    modifier = Modifier.padding(contentPadding)
                )
                WorkspaceTab.PROFILE -> ProfileScreen(
                    onReturnToOnboarding = onReturnToOnboarding,
                    modifier = Modifier.padding(contentPadding)
                )
            }
        }
    }
}

@Composable
private fun HomeScreen(
    pendingTaskCount: Int,
    onOpenDiagnosis: () -> Unit,
    onCreateTask: () -> Unit,
    onViewAllAlerts: () -> Unit,
    onOpenVideoFactory: () -> Unit,
    onOpenImport: () -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("本地演示数据", style = MaterialTheme.typography.titleMedium)
        Text(
            "以下内容仅用于本机预览，尚未提交或同步至服务端。",
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("优先关注", style = MaterialTheme.typography.labelLarge)
                Text("午市套餐核销下降 14%", style = MaterialTheme.typography.titleLarge)
                Text("数据完整度 78%", color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onOpenDiagnosis) { Text("查看诊断") }
                    TextButton(onClick = onCreateTask) { Text("创建行动任务") }
                }
            }
        }
        TextButton(onClick = onViewAllAlerts) { Text("查看全部提醒") }
        HorizontalDivider()
        Text("工作入口", style = MaterialTheme.typography.titleMedium)
        EntryRow(title = "导入经营数据", detail = "本地演示：手工录入和待确认项", onClick = onOpenImport)
        EntryRow(title = "经营诊断", detail = "查看本地演示诊断", onClick = onOpenDiagnosis)
        EntryRow(title = "AI 视频工厂", detail = "本地占位，暂未生成视频", onClick = onOpenVideoFactory)
        Text("待办任务 $pendingTaskCount 项", style = MaterialTheme.typography.titleMedium)
    }
}

@Composable
private fun EntryRow(title: String, detail: String, onClick: () -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleSmall)
                Text(detail, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(modifier = Modifier.width(8.dp))
            TextButton(onClick = onClick) { Text("查看") }
        }
    }
}

@Composable
private fun TasksScreen(tasks: List<LocalActionTask>, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("行动任务", style = MaterialTheme.typography.titleLarge)
        if (tasks.isEmpty()) {
            Text("暂无本地行动任务。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        tasks.forEach { task ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(task.title, style = MaterialTheme.typography.titleMedium)
                    Text("负责人：${task.owner}")
                    Text("截止：${task.dueDate}")
                    Text("指标：${task.metric}")
                    Text("状态：${task.status}")
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DiagnosisScreen(onBack: () -> Unit, onCreateTask: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("经营诊断") },
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
            Text("本地演示数据", style = MaterialTheme.typography.titleMedium)
            Text("此诊断未调用 AI 或服务端，不代表已生成、已审核或已同步的正式结论。")
            DiagnosisSection("1. 数据质量", "午市套餐核销数据完整度为 78%，请补齐渠道与时段记录。")
            DiagnosisSection("2. 诊断问题", "午市套餐核销下降 14%，需要核对套餐曝光与门店承接。")
            DiagnosisSection("3. 行动建议", "检查菜单入口、海报陈列和收银推荐话术，并记录每日核销。")
            Button(onClick = onCreateTask) { Text("创建行动任务") }
            DiagnosisSection("4. 反思复盘", "明日午市结束后比较核销率与套餐曝光，确认行动是否有效。")
            DiagnosisSection("5. 一句话方向", "先补齐数据，再让午市套餐在顾客点单路径中更容易被看见。")
        }
    }
}

@Composable
private fun DiagnosisSection(title: String, content: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(content, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VideoFactoryScreen(
    stage: VideoFactoryStage,
    selectedTopic: String,
    copyDraft: String,
    onSelectTopic: (String) -> Unit,
    onCopyDraftChanged: (String) -> Unit,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onClose: () -> Unit,
    onReturnHome: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI 视频工厂") },
                navigationIcon = { TextButton(onClick = onReturnHome) { Text("返回首页") } },
                actions = { TextButton(onClick = onClose) { Text("关闭") } }
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
            Text("本地演示流程", style = MaterialTheme.typography.titleMedium)
            Text(
                "第 ${stage.ordinal + 1} / ${VideoFactoryStage.entries.size} 步",
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            VideoStageIndicator(currentStage = stage)
            HorizontalDivider()
            VideoFactoryStageContent(
                stage = stage,
                selectedTopic = selectedTopic,
                copyDraft = copyDraft,
                onSelectTopic = onSelectTopic,
                onCopyDraftChanged = onCopyDraftChanged
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                TextButton(onClick = onPrevious, enabled = stage != VideoFactoryStage.TOPIC) {
                    Text("上一步")
                }
                Button(onClick = onNext, enabled = stage != VideoFactoryStage.LIBRARY) {
                    Text("下一步")
                }
            }
        }
    }
}

@Composable
private fun VideoStageIndicator(currentStage: VideoFactoryStage) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        VideoFactoryStage.entries.forEachIndexed { index, item ->
            val marker = if (item == currentStage) "●" else "○"
            val label = if (item == currentStage) {
                "$marker ${index + 1}. ${item.title}（当前）"
            } else {
                "$marker ${index + 1}. ${item.title}"
            }
            Text(
                label,
                color = if (item == currentStage) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                }
            )
        }
    }
}

@Composable
private fun VideoFactoryStageContent(
    stage: VideoFactoryStage,
    selectedTopic: String,
    copyDraft: String,
    onSelectTopic: (String) -> Unit,
    onCopyDraftChanged: (String) -> Unit
) {
    when (stage) {
        VideoFactoryStage.TOPIC -> TopicStage(
            selectedTopic = selectedTopic,
            onSelectTopic = onSelectTopic
        )
        VideoFactoryStage.COPY -> CopyStage(copyDraft, onCopyDraftChanged)
        VideoFactoryStage.COPY_COMPLIANCE -> ComplianceStage()
        VideoFactoryStage.STORYBOARD -> StoryboardStage()
        VideoFactoryStage.ASSETS -> MaterialsStage()
        VideoFactoryStage.LIBRARY -> LibraryStage()
    }
}

@Composable
private fun TopicStage(selectedTopic: String, onSelectTopic: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("选题", style = MaterialTheme.typography.titleLarge)
        Text("选择一个本地示例选题。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        VideoFactoryLocalContent.sources.forEach { source ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(source.label, style = MaterialTheme.typography.labelLarge)
                    source.topics.forEach { topic ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(topic, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    if (selectedTopic == topic) "已选本地示例" else "本地示例",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            TextButton(onClick = { onSelectTopic(topic) }) {
                                Text(if (selectedTopic == topic) "已选择" else "选择")
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CopyStage(copyDraft: String, onCopyDraftChanged: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("文案", style = MaterialTheme.typography.titleLarge)
        Text("编辑本地文案草稿。", color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextField(
            value = copyDraft,
            onValueChange = onCopyDraftChanged,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("视频文案") },
            minLines = 5
        )
    }
}

@Composable
private fun ComplianceStage() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("文字合规", style = MaterialTheme.typography.titleLarge)
        Text("本地规则演示，不构成平台审核结果")
        Text("请以实际发布平台的规则与审核结果为准。", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StoryboardStage() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("分镜", style = MaterialTheme.typography.titleLarge)
        VideoFactoryLocalContent.shots.forEach { shot ->
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(shot.title, style = MaterialTheme.typography.titleSmall)
                    Text(shot.filmingGuidance)
                    Text(shot.materialPlaceholder, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun MaterialsStage() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("素材", style = MaterialTheme.typography.titleLarge)
        Text("素材占位：未选择、读取或传输任何文件。")
        Card(modifier = Modifier.fillMaxWidth()) {
            Text(
                "图片与视频素材将在接入后显示；当前仅为本地占位。",
                modifier = Modifier.padding(16.dp),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun LibraryStage() {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("视频库", style = MaterialTheme.typography.titleLarge)
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Text("午市双人套餐短片", style = MaterialTheme.typography.titleSmall)
                Text("示例条目，未生成真实视频")
                Text("本地处理状态占位，未进入生成队列", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ProfileScreen(onReturnToOnboarding: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("我的", style = MaterialTheme.typography.titleLarge)
        Text("当前为本地演示，没有账号、同步状态或云端门店资料。")
        Button(onClick = onReturnToOnboarding) { Text("返回修改门店档案") }
    }
}

@Composable
private fun LocalPlaceholderScreen(title: String, message: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text(title, style = MaterialTheme.typography.titleLarge)
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
