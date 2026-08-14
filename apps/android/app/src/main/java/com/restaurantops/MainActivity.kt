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
import androidx.compose.runtime.remember
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
import com.restaurantops.content.ContentProfileHttpClient
import com.restaurantops.content.ContentProfileViewModel
import com.restaurantops.content.ContentProfileGate
import com.restaurantops.content.StoreContentProfile
import com.restaurantops.content.contentProfileGate
import com.restaurantops.content.contentProfileEndpointConfigured
import com.restaurantops.content.RootScreen

class MainActivity : ComponentActivity() {
    private val onboardingViewModel: StoreOnboardingViewModel by viewModels()
    private val workspaceViewModel: WorkspaceViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                val rootScreen = rememberSaveable { androidx.compose.runtime.mutableStateOf(RootScreen.ONBOARDING) }
                val profileViewModel = remember {
                    ContentProfileViewModel(ContentProfileHttpClient(BuildConfig.CONTENT_PROFILE_API_BASE_URL) {
                        if (BuildConfig.DEBUG) mapOf("X-Development-Context" to "ent_demo:store_demo:actor_demo") else emptyMap()
                    })
                }
                when (rootScreen.value) {
                    RootScreen.WORKSPACE -> if (contentProfileGate(profileViewModel.state) == ContentProfileGate.Ready) {
                        WorkspaceRoot(viewModel = workspaceViewModel, onReturnToOnboarding = { rootScreen.value = RootScreen.ONBOARDING })
                    } else ContentProfileScreen(viewModel = profileViewModel, endpointConfigured = contentProfileEndpointConfigured(BuildConfig.CONTENT_PROFILE_API_BASE_URL), onReady = { rootScreen.value = nextRootScreen(RootScreen.PROFILE, contentProfileGate(profileViewModel.state)) }, onBack = { rootScreen.value = RootScreen.ONBOARDING })
                    RootScreen.PROFILE -> ContentProfileScreen(viewModel = profileViewModel, endpointConfigured = contentProfileEndpointConfigured(BuildConfig.CONTENT_PROFILE_API_BASE_URL), onReady = { rootScreen.value = nextRootScreen(RootScreen.PROFILE, contentProfileGate(profileViewModel.state)) }, onBack = { rootScreen.value = RootScreen.ONBOARDING })
                    RootScreen.ONBOARDING -> StoreOnboardingScreen(viewModel = onboardingViewModel, onEnterWorkspace = { if (contentProfileEndpointConfigured(BuildConfig.CONTENT_PROFILE_API_BASE_URL)) { rootScreen.value = nextRootScreen(RootScreen.ONBOARDING, contentProfileGate(profileViewModel.state)); profileViewModel.load("store_demo") } })
                }
            }
        }
    }
}

@Composable
private fun ContentProfileScreen(viewModel: ContentProfileViewModel, endpointConfigured: Boolean, onReady: () -> Unit, onBack: () -> Unit) {
    val current = viewModel.state.profile
    val address = rememberSaveable(current?.detailedAddress) { androidx.compose.runtime.mutableStateOf(current?.detailedAddress ?: "") }
    val storeName = rememberSaveable(current?.storeName) { androidx.compose.runtime.mutableStateOf(current?.storeName ?: "") }
    val industry = rememberSaveable(current?.industryCode) { androidx.compose.runtime.mutableStateOf(current?.industryCode ?: "") }
    val category = rememberSaveable(current?.categoryCode) { androidx.compose.runtime.mutableStateOf(current?.categoryCode ?: "") }
    val province = rememberSaveable(current?.provinceCode) { androidx.compose.runtime.mutableStateOf(current?.provinceCode ?: "") }
    val city = rememberSaveable(current?.cityCode) { androidx.compose.runtime.mutableStateOf(current?.cityCode ?: "") }
    val district = rememberSaveable(current?.districtCode) { androidx.compose.runtime.mutableStateOf(current?.districtCode ?: "") }
    val businessDistrict = rememberSaveable(current?.businessDistrictType) { androidx.compose.runtime.mutableStateOf(current?.businessDistrictType ?: "") }
    val operatingMode = rememberSaveable(current?.operatingMode) { androidx.compose.runtime.mutableStateOf(current?.operatingMode ?: "") }
    Scaffold(topBar = { TopAppBar(title = { Text("门店内容档案") }) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("完成门店档案后才能进入内容工作台", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(storeName.value, { storeName.value = it }, label = { Text("门店名称") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(address.value, { address.value = it }, label = { Text("详细地址") }, modifier = Modifier.fillMaxWidth())
            ProfileChoice("Industry", industry.value, listOf("fast_food", "full_service", "hotpot_skewers", "barbecue_night", "beverages_desserts", "bakery", "snacks_local", "other"), { industry.value = it })
            ProfileChoice("Category", category.value, listOf("rice_noodle", "chinese_dining", "sichuan", "hotpot", "skewers", "barbecue", "night_market", "tea_coffee", "dessert", "bakery", "snacks", "local_specialty", "other"), { category.value = it })
            ProfileChoice("Province", province.value, listOf("sc"), { province.value = it })
            ProfileChoice("City", city.value, listOf("cd"), { city.value = it })
            ProfileChoice("District", district.value, listOf("sl"), { district.value = it })
            ProfileChoice("Business district", businessDistrict.value, listOf("office", "community", "mall", "school", "scenic", "transport", "industrial_park", "mixed", "food_street", "other"), { businessDistrict.value = it })
            ProfileChoice("Operating mode", operatingMode.value, listOf("dine_in", "takeaway", "dine_in_takeaway", "group_buy", "multi_mode"), { operatingMode.value = it })
            if (viewModel.state.error != null) Text(viewModel.state.error!!, color = MaterialTheme.colorScheme.error)
            if (!endpointConfigured) Text("内容服务暂未配置，暂不能提交门店档案", color = MaterialTheme.colorScheme.error)
            Button(onClick = {
                viewModel.submit("store_demo", StoreContentProfile("store_demo", storeName.value, industry.value, category.value, provinceCode = province.value, cityCode = city.value, districtCode = district.value, detailedAddress = address.value, businessDistrictType = businessDistrict.value, operatingMode = operatingMode.value), current != null)
            }, enabled = endpointConfigured && listOf(storeName.value, industry.value, category.value, province.value, city.value, district.value, address.value, businessDistrict.value, operatingMode.value).all { it.isNotBlank() }) { Text("提交档案") }
            if (contentProfileGate(viewModel.state) == ContentProfileGate.Ready) Button(onClick = onReady) { Text("进入内容工作台") }
            TextButton(onClick = onBack) { Text("返回") }
        }
    }
}

@Composable
private fun ProfileChoice(label: String, selected: String, options: List<String>, onSelected: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        options.forEach { option ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = selected == option, onClick = { onSelected(option) })
                Text(option)
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
