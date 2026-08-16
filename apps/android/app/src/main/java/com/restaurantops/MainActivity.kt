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
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import com.restaurantops.onboarding.BusinessType
import com.restaurantops.onboarding.OnboardingStep
import com.restaurantops.onboarding.StoreFactDraft
import com.restaurantops.onboarding.StoreOnboardingViewModel
import com.restaurantops.auth.AuthApi
import com.restaurantops.auth.AuthenticatedApiClient
import com.restaurantops.auth.EncryptedRefreshTokenStore
import com.restaurantops.auth.HttpAuthRepository
import com.restaurantops.auth.LoginScreen
import com.restaurantops.auth.LoginViewModel
import com.restaurantops.auth.PasswordChangeScreen
import com.restaurantops.auth.PasswordChangeViewModel
import com.restaurantops.auth.AppSessionState
import com.restaurantops.auth.PreferencesSelectedStoreStore
import com.restaurantops.auth.RemoteServiceUnavailableScreen
import com.restaurantops.auth.SessionViewModel
import com.restaurantops.auth.StoreSelectionScreen
import com.restaurantops.imports.network.LocalImportApiRuntime
import com.restaurantops.workspace.WorkspaceRoot
import com.restaurantops.workspace.WorkspaceViewModel
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class MainActivity : ComponentActivity() {
    private val onboardingViewModel: StoreOnboardingViewModel by viewModels()
    private val workspaceViewModel: WorkspaceViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                val canUseRemoteApi = LocalImportApiRuntime.canUseLocalApi(
                    isDebug = BuildConfig.DEBUG,
                    baseUrl = BuildConfig.LOCAL_API_BASE_URL
                )
                if (canUseRemoteApi) {
                    AuthenticatedAppRoot(
                        workspaceViewModel = workspaceViewModel,
                        onboardingViewModel = onboardingViewModel
                    )
                } else {
                    RemoteServiceUnavailableScreen()
                }
            }
        }
    }
}

@Composable
private fun AuthenticatedAppRoot(
    workspaceViewModel: WorkspaceViewModel,
    onboardingViewModel: StoreOnboardingViewModel
) {
    val context = LocalContext.current.applicationContext
    val repository = remember(context) {
        val api = Retrofit.Builder()
            .baseUrl(BuildConfig.LOCAL_API_BASE_URL)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(AuthApi::class.java)
        HttpAuthRepository(api, EncryptedRefreshTokenStore(context))
    }
    val sessionViewModel = remember(repository, context) {
        SessionViewModel(repository, PreferencesSelectedStoreStore(context), SavedStateHandle())
    }
    val loginViewModel = remember(repository) { LoginViewModel(repository, SavedStateHandle()) }
    val passwordChangeViewModel = remember(repository) { PasswordChangeViewModel(repository, SavedStateHandle()) }
    val authenticatedApiClient = remember(repository) { AuthenticatedApiClient(repository) }
    var isInLocalWorkspace by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(sessionViewModel) {
        sessionViewModel.restore()
    }
    LaunchedEffect(repository, sessionViewModel) {
        repository.onSessionInvalidated = sessionViewModel::onSessionInvalidated
    }

    if (isInLocalWorkspace) {
        LocalDemoRoot(
            workspaceViewModel = workspaceViewModel,
            onboardingViewModel = onboardingViewModel,
            onExit = {
                isInLocalWorkspace = false
                sessionViewModel.leaveLocalDemo()
            }
        )
        return
    }

    when (val state = sessionViewModel.state) {
        AppSessionState.Loading -> SessionLoadingScreen()
        AppSessionState.Login -> LoginScreen(
            viewModel = loginViewModel,
            allowLocalDemo = BuildConfig.DEBUG,
            onLocalDemo = {
                sessionViewModel.enterLocalDemo()
                isInLocalWorkspace = true
            },
            onAuthenticated = sessionViewModel::acceptLogin
        )
        is AppSessionState.ForcedPasswordChange -> PasswordChangeScreen(
            loginName = state.loginName,
            viewModel = passwordChangeViewModel,
            onChanged = sessionViewModel::acceptChangedPassword
        )
        is AppSessionState.StoreSelection -> StoreSelectionScreen(state.stores, sessionViewModel::selectStore)
        is AppSessionState.RemoteWorkspace -> WorkspaceRoot(
            viewModel = workspaceViewModel,
            onReturnToOnboarding = sessionViewModel::logout,
            storeId = state.store.storeId,
            authenticatedApiClient = authenticatedApiClient,
            onReturnToLogin = sessionViewModel::logout,
            onLogout = sessionViewModel::logout,
            onChooseAnotherStore = sessionViewModel::chooseAnotherStore
        )
        AppSessionState.LocalDemo -> Unit
    }
}

@Composable
private fun LocalDemoRoot(
    workspaceViewModel: WorkspaceViewModel,
    onboardingViewModel: StoreOnboardingViewModel,
    onExit: () -> Unit
) {
    var isInWorkspace by rememberSaveable { mutableStateOf(false) }
    if (isInWorkspace) {
        WorkspaceRoot(
            viewModel = workspaceViewModel,
            onReturnToOnboarding = onExit,
            storeId = "store_demo",
            onReturnToLogin = onExit
        )
    } else {
        StoreOnboardingScreen(viewModel = onboardingViewModel, onEnterWorkspace = { isInWorkspace = true })
    }
}

@Composable
private fun SessionLoadingScreen() {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        CircularProgressIndicator()
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
                        onClick = { onBusinessTypeSelected(type) },
                        modifier = Modifier.testTag("business-type-${type.wireValue}")
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
