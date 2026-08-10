package com.restaurantops

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.restaurantops.onboarding.BusinessType
import com.restaurantops.onboarding.OnboardingStep
import com.restaurantops.onboarding.StoreFactDraft
import com.restaurantops.onboarding.StoreOnboardingViewModel
import com.restaurantops.workspace.WorkspaceRoot
import com.restaurantops.workspace.WorkspaceViewModel

class MainActivity : ComponentActivity() {
    private val onboardingViewModel: StoreOnboardingViewModel by viewModels()
    private val workspaceViewModel: WorkspaceViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                var isInWorkspace = rememberSaveable { false }
                if (isInWorkspace) {
                    WorkspaceRoot(
                        viewModel = workspaceViewModel,
                        onReturnToOnboarding = { isInWorkspace = false }
                    )
                } else {
                    StoreOnboardingScreen(
                        viewModel = onboardingViewModel,
                        onEnterWorkspace = { isInWorkspace = true }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreOnboardingScreen(
    viewModel: StoreOnboardingViewModel,
    onEnterWorkspace: () -> Unit
) {
    val steps = OnboardingStep.entries
    val step = steps[viewModel.stepIndex]

    Scaffold(
        topBar = { TopAppBar(title = { Text("餐饮经营助手") }) }
    ) { contentPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("完善门店档案", style = MaterialTheme.typography.titleLarge)
            Text(
                text = "第 ${viewModel.stepIndex + 1} 步，共 ${steps.size} 步：${step.title}",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            LinearProgressIndicator(
                progress = { (viewModel.stepIndex + 1).toFloat() / steps.size },
                modifier = Modifier.fillMaxWidth()
            )

            if (viewModel.isPreviewing) {
                LocalPreviewContent(
                    draft = viewModel.draft,
                    onReturnToEditing = viewModel::exitPreview,
                    onEnterWorkspace = onEnterWorkspace
                )
            } else {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)
                    ) {
                        StepContent(
                            step = step,
                            draft = viewModel.draft,
                            averageSpendInput = viewModel.averageSpendInput,
                            onStoreNameChanged = viewModel::updateStoreName,
                            onBusinessTypeSelected = viewModel::updateBusinessType,
                            onAverageSpendChanged = viewModel::updateAverageSpendYuan,
                            onGoalChanged = viewModel::updateCurrentGoal
                        )
                    }
                }

                Spacer(modifier = Modifier.weight(1f))
                HorizontalDivider()
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    TextButton(
                        onClick = viewModel::goBack,
                        enabled = viewModel.stepIndex > 0
                    ) { Text("上一步") }
                    if (viewModel.stepIndex < steps.lastIndex) {
                        Button(onClick = viewModel::goNext) { Text("下一步") }
                    } else {
                        Button(
                            onClick = viewModel::previewLocally,
                            enabled = viewModel.draft.isReadyForDiagnosis
                        ) { Text("本地预览") }
                    }
                }
            }
        }
    }
}

@Composable
private fun StepContent(
    step: OnboardingStep,
    draft: StoreFactDraft,
    averageSpendInput: String,
    onStoreNameChanged: (String) -> Unit,
    onBusinessTypeSelected: (BusinessType) -> Unit,
    onAverageSpendChanged: (String) -> Unit,
    onGoalChanged: (String) -> Unit
) {
    when (step) {
        OnboardingStep.BASICS -> {
            Text("门店信息", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = draft.storeName,
                onValueChange = onStoreNameChanged,
                label = { Text("门店名称") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }
        OnboardingStep.POSITIONING -> {
            Text("餐饮业态", style = MaterialTheme.typography.titleMedium)
            BusinessType.entries.forEach { type ->
                Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(
                        selected = draft.businessType == type,
                        onClick = { onBusinessTypeSelected(type) }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(type.displayName)
                }
            }
        }
        OnboardingStep.OPERATIONS -> {
            Text("经营基线", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = averageSpendInput,
                onValueChange = onAverageSpendChanged,
                label = { Text("人均消费") },
                prefix = { Text("¥") },
                supportingText = { Text("请输入正整数金额（元）") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
        }
        OnboardingStep.GOAL -> {
            Text("本期经营目标", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = draft.currentGoal,
                onValueChange = onGoalChanged,
                label = { Text("希望优先改善什么？") },
                minLines = 4,
                modifier = Modifier.fillMaxWidth()
            )
        }
    }
}

@Composable
private fun LocalPreviewContent(
    draft: StoreFactDraft,
    onReturnToEditing: () -> Unit,
    onEnterWorkspace: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("本地预览", style = MaterialTheme.typography.titleMedium)
            Text(
                "${draft.storeName} 的建档信息已在本地预览，服务端接入后才能正式提交。",
                style = MaterialTheme.typography.bodyMedium
            )
            TextButton(onClick = onReturnToEditing) {
                Text("返回修改")
            }
            Button(onClick = onEnterWorkspace, modifier = Modifier.fillMaxWidth()) {
                Text("进入今日经营")
            }
        }
    }
}
