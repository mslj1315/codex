package com.restaurantops.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

class LoginViewModel(
    private val repository: AuthRepository,
    @Suppress("UNUSED_PARAMETER") savedStateHandle: SavedStateHandle
) : ViewModel() {
    var loginName by mutableStateOf("")
    var password by mutableStateOf("")
    var uiState by mutableStateOf<LoginUiState>(LoginUiState.Idle)
        private set

    fun submit() {
        val normalizedLoginName = loginName.trim()
        val submittedPassword = password
        password = ""
        if (normalizedLoginName.isEmpty() || submittedPassword.isEmpty()) {
            uiState = LoginUiState.Error("请输入账号和密码")
            return
        }

        uiState = LoginUiState.Loading
        viewModelScope.launch {
            uiState = try {
                LoginUiState.Success(normalizedLoginName, repository.login(normalizedLoginName, submittedPassword))
            } catch (error: AuthRequestException) {
                if (error.statusCode == 401) {
                    LoginUiState.Error("账号或密码不正确")
                } else {
                    LoginUiState.Error("暂时无法登录，请稍后重试")
                }
            } catch (_: Exception) {
                LoginUiState.Error("暂时无法登录，请稍后重试")
            }
        }
    }

    fun clearConsumedResult() {
        if (uiState is LoginUiState.Success) {
            uiState = LoginUiState.Idle
        }
    }
}
