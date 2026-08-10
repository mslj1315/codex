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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceRoot(
    viewModel: WorkspaceViewModel,
    onReturnToOnboarding: () -> Unit
) {
    when {
        viewModel.isDiagnosisOpen -> DiagnosisScreen(
            onBack = viewModel::closeOverlay,
            onCreateTask = viewModel::createPriorityTask
        )
        viewModel.isVideoFactoryOpen -> VideoFactoryPlaceholder(onBack = viewModel::closeOverlay)
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
private fun VideoFactoryPlaceholder(onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("AI 视频工厂") },
                navigationIcon = { TextButton(onClick = onBack) { Text("返回") } }
            )
        }
    ) { contentPadding ->
        LocalPlaceholderScreen(
            title = "本地占位",
            message = "视频生成流程尚未接入。本地演示没有创建视频、调用 AI 或上传素材。",
            modifier = Modifier.padding(contentPadding)
        )
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
