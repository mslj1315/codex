package com.restaurantops.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    viewModel: LoginViewModel,
    allowLocalDemo: Boolean,
    onLocalDemo: () -> Unit,
    onAuthenticated: (String, AuthenticatedSession) -> Unit
) {
    val loginState = viewModel.uiState
    if (loginState is LoginUiState.Success) {
        LaunchedEffect(loginState) {
            onAuthenticated(loginState.loginName, loginState.session)
            viewModel.clearConsumedResult()
        }
    }
    Scaffold(topBar = { TopAppBar(title = { Text("餐饮经营助手") }) }) { contentPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(contentPadding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("登录门店工作台", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = viewModel.loginName,
                onValueChange = { viewModel.loginName = it },
                label = { Text("账号") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = viewModel.password,
                onValueChange = { viewModel.password = it },
                label = { Text("密码") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            when (val state = loginState) {
                LoginUiState.Loading -> CircularProgressIndicator()
                is LoginUiState.Error -> Text(state.message, color = MaterialTheme.colorScheme.error)
                else -> Unit
            }
            Button(
                onClick = viewModel::submit,
                enabled = viewModel.uiState != LoginUiState.Loading,
                modifier = Modifier.fillMaxWidth()
            ) { Text("登录") }
            if (allowLocalDemo) {
                TextButton(onClick = onLocalDemo, modifier = Modifier.fillMaxWidth()) { Text("本地演示") }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PasswordChangeScreen(
    loginName: String,
    viewModel: PasswordChangeViewModel,
    onChanged: (AuthenticatedSession) -> Unit
) {
    val state = viewModel.uiState
    if (state is PasswordChangeUiState.Success) {
        LaunchedEffect(state) {
            onChanged(state.session)
            viewModel.clearConsumedResult()
        }
    }
    Scaffold(topBar = { TopAppBar(title = { Text("修改初始密码") }) }) { contentPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(contentPadding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("请先修改初始密码后再进入门店工作台", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = viewModel.currentPassword,
                onValueChange = { viewModel.currentPassword = it },
                label = { Text("当前密码") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = viewModel.newPassword,
                onValueChange = { viewModel.newPassword = it },
                label = { Text("新密码，至少 12 位") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            OutlinedTextField(
                value = viewModel.confirmation,
                onValueChange = { viewModel.confirmation = it },
                label = { Text("确认新密码") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            when (state) {
                PasswordChangeUiState.Loading -> CircularProgressIndicator()
                is PasswordChangeUiState.Error -> Text(state.message, color = MaterialTheme.colorScheme.error)
                else -> Unit
            }
            Button(
                onClick = { viewModel.submit(loginName) },
                enabled = state != PasswordChangeUiState.Loading,
                modifier = Modifier.fillMaxWidth()
            ) { Text("确认修改") }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StoreSelectionScreen(stores: List<StoreMembership>, onSelect: (StoreMembership) -> Unit) {
    Scaffold(topBar = { TopAppBar(title = { Text("选择门店") }) }) { contentPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(contentPadding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("请选择要进入的门店", style = MaterialTheme.typography.titleLarge)
            stores.forEach { store ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(store.storeId, style = MaterialTheme.typography.titleMedium)
                        Text("权限：${if (store.role == StoreRole.OWNER) "店主" else "运营人员"}")
                        Button(onClick = { onSelect(store) }) { Text("进入门店") }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemoteServiceUnavailableScreen() {
    Scaffold(topBar = { TopAppBar(title = { Text("餐饮经营助手") }) }) { contentPadding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(contentPadding).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("服务端尚未配置", style = MaterialTheme.typography.titleLarge)
            Text("请由部署人员配置服务端地址后登录门店工作台。")
        }
    }
}
