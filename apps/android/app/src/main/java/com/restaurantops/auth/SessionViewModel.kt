package com.restaurantops.auth

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

interface SelectedStoreStore {
    var storeId: String?
}

sealed interface AppSessionState {
    data object Loading : AppSessionState
    data object Login : AppSessionState
    data class StoreSelection(val stores: List<StoreMembership>) : AppSessionState
    data class RemoteWorkspace(val store: StoreMembership) : AppSessionState
    data object LocalDemo : AppSessionState
}

class SessionViewModel(
    private val repository: AuthRepository,
    private val selectedStoreStore: SelectedStoreStore,
    @Suppress("UNUSED_PARAMETER") savedStateHandle: SavedStateHandle
) : ViewModel() {
    private var authorizedStores: List<StoreMembership> = emptyList()

    var state by mutableStateOf<AppSessionState>(AppSessionState.Loading)
        private set

    fun restore() {
        state = AppSessionState.Loading
        viewModelScope.launch {
            try {
                transitionToAuthorizedStores(repository.restore())
            } catch (_: AuthRequestException) {
                state = AppSessionState.Login
            }
        }
    }

    fun acceptLogin(stores: List<StoreMembership>) {
        transitionToAuthorizedStores(stores)
    }

    fun selectStore(store: StoreMembership) {
        val current = state as? AppSessionState.StoreSelection ?: return
        if (store !in current.stores) return
        selectedStoreStore.storeId = store.storeId
        state = AppSessionState.RemoteWorkspace(store)
    }

    fun chooseAnotherStore() {
        if (state !is AppSessionState.RemoteWorkspace || authorizedStores.isEmpty()) return
        selectedStoreStore.storeId = null
        state = AppSessionState.StoreSelection(authorizedStores)
    }

    fun logout() {
        selectedStoreStore.storeId = null
        state = AppSessionState.Loading
        viewModelScope.launch {
            try {
                repository.logout()
            } finally {
                state = AppSessionState.Login
            }
        }
    }

    fun enterLocalDemo() {
        state = AppSessionState.LocalDemo
    }

    fun leaveLocalDemo() {
        state = AppSessionState.Login
    }

    fun onSessionInvalidated() {
        viewModelScope.launch {
            selectedStoreStore.storeId = null
            state = AppSessionState.Login
        }
    }

    private fun transitionToAuthorizedStores(stores: List<StoreMembership>) {
        authorizedStores = stores
        val selected = selectedStoreStore.storeId?.let { storeId ->
            stores.firstOrNull { it.storeId == storeId }
        }
        state = when {
            selected != null -> AppSessionState.RemoteWorkspace(selected)
            stores.size == 1 -> AppSessionState.RemoteWorkspace(stores.single()).also {
                selectedStoreStore.storeId = stores.single().storeId
            }
            stores.isNotEmpty() -> AppSessionState.StoreSelection(stores)
            else -> AppSessionState.Login
        }
    }
}
