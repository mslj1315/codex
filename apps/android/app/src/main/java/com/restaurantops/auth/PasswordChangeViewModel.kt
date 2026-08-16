package com.restaurantops.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

sealed interface PasswordChangeUiState {
    data object Idle : PasswordChangeUiState
    data object Loading : PasswordChangeUiState
    data class Success(val session: AuthenticatedSession) : PasswordChangeUiState
    data class Error(val message: String) : PasswordChangeUiState
}

class PasswordChangeViewModel(
    private val repository: AuthRepository,
    @Suppress("UNUSED_PARAMETER") savedStateHandle: SavedStateHandle
) : ViewModel() {
    var currentPassword by mutableStateOf("")
    var newPassword by mutableStateOf("")
    var confirmation by mutableStateOf("")
    var uiState by mutableStateOf<PasswordChangeUiState>(PasswordChangeUiState.Idle)
        private set

    fun submit(loginName: String) {
        val current = currentPassword
        val next = newPassword
        val confirm = confirmation
        currentPassword = ""
        newPassword = ""
        confirmation = ""
        if (current.isEmpty() || next.length < 12 || next != confirm) {
            uiState = PasswordChangeUiState.Error("请输入当前密码，并设置至少 12 位且两次一致的新密码")
            return
        }
        uiState = PasswordChangeUiState.Loading
        viewModelScope.launch {
            uiState = try {
                PasswordChangeUiState.Success(repository.changePassword(loginName, current, next))
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                PasswordChangeUiState.Error("无法完成密码修改，请重新登录后重试")
            }
        }
    }

    fun clearConsumedResult() {
        if (uiState is PasswordChangeUiState.Success) uiState = PasswordChangeUiState.Idle
    }
}
