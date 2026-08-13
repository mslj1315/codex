package com.restaurantops.content

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class ContentProfileState(val profile: StoreContentProfile? = null, val stages: List<OperatingStage> = emptyList(), val loading: Boolean = false, val loaded: Boolean = false, val error: String? = null)

class ContentProfileViewModel(private val repository: ContentProfileRepository) : ViewModel() {
    var state by mutableStateOf(ContentProfileState())
        private set

    fun load(storeId: String) = viewModelScope.launch {
        state = state.copy(loading = true, error = null)
        runCatching { repository.getProfile(storeId) to repository.listOperatingStages(storeId) }
            .onSuccess { (profile, stages) -> state = ContentProfileState(profile, stages, loaded = true) }
            .onFailure { state = state.copy(loading = false, loaded = true, error = (it as? ContentProfileHttpException)?.neutralMessage ?: "暂时无法加载门店档案" ) }
    }

    fun submit(storeId: String, profile: StoreContentProfile, existing: Boolean) = viewModelScope.launch {
        if (profile.missingRequiredFields().isNotEmpty()) { state = state.copy(error = "required profile fields missing"); return@launch }
        runCatching { if (existing) repository.updateProfile(storeId, profile) else repository.createProfile(storeId, profile) }
            .onSuccess { state = state.copy(profile = it, error = null) }
            .onFailure { state = state.copy(error = (it as? ContentProfileHttpException)?.neutralMessage ?: "暂时无法保存门店档案" ) }
    }

    fun addStage(storeId: String, stage: OperatingStage) = viewModelScope.launch {
        runCatching { repository.addOperatingStage(storeId, stage) }
            .onSuccess { state = state.copy(stages = listOf(it) + state.stages, error = null) }
            .onFailure { state = state.copy(error = it.message) }
    }
}
