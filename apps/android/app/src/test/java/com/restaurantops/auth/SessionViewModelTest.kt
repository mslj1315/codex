package com.restaurantops.auth

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SessionViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val storeA = StoreMembership("ent_a", "store_a", StoreRole.OWNER)
    private val storeB = StoreMembership("ent_b", "store_b", StoreRole.OPERATOR)

    @Before fun setUp() { Dispatchers.setMain(dispatcher) }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun restoredSingleStoreSessionEntersRemoteWorkspace() = runTest {
        val viewModel = SessionViewModel(FakeRepository(listOf(storeA)), FakeSelectedStoreStore(), SavedStateHandle())

        viewModel.restore()
        advanceUntilIdle()

        assertEquals(AppSessionState.RemoteWorkspace(storeA), viewModel.state)
    }

    @Test
    fun multipleStoresRequireSelectionUntilUserChoosesOne() = runTest {
        val selection = FakeSelectedStoreStore()
        val viewModel = SessionViewModel(FakeRepository(listOf(storeA, storeB)), selection, SavedStateHandle())

        viewModel.restore()
        advanceUntilIdle()
        assertEquals(AppSessionState.StoreSelection(listOf(storeA, storeB)), viewModel.state)

        viewModel.selectStore(storeB)
        assertEquals(AppSessionState.RemoteWorkspace(storeB), viewModel.state)
        assertEquals("store_b", selection.storeId)
    }

    @Test
    fun invalidPersistedStoreReturnsToSelection() = runTest {
        val viewModel = SessionViewModel(
            FakeRepository(listOf(storeA, storeB)),
            FakeSelectedStoreStore("store_removed"),
            SavedStateHandle()
        )

        viewModel.restore()
        advanceUntilIdle()

        assertEquals(AppSessionState.StoreSelection(listOf(storeA, storeB)), viewModel.state)
    }

    @Test
    fun logoutClearsSelectedStoreAndReturnsToLogin() = runTest {
        val repository = FakeRepository(listOf(storeA))
        val selection = FakeSelectedStoreStore("store_a")
        val viewModel = SessionViewModel(repository, selection, SavedStateHandle())

        viewModel.logout()
        advanceUntilIdle()

        assertEquals(AppSessionState.Login, viewModel.state)
        assertEquals(null, selection.storeId)
        assertEquals(1, repository.logoutCalls)
    }

    @Test
    fun chooseAnotherStoreReturnsTheCurrentAuthorizedStoreList() = runTest {
        val viewModel = SessionViewModel(FakeRepository(listOf(storeA, storeB)), FakeSelectedStoreStore(), SavedStateHandle())
        viewModel.restore()
        advanceUntilIdle()
        viewModel.selectStore(storeA)

        viewModel.chooseAnotherStore()

        assertEquals(AppSessionState.StoreSelection(listOf(storeA, storeB)), viewModel.state)
    }

    @Test
    fun localDemoNeverCallsTheAuthRepository() = runTest {
        val repository = FakeRepository(listOf(storeA))
        val viewModel = SessionViewModel(repository, FakeSelectedStoreStore(), SavedStateHandle())

        viewModel.enterLocalDemo()

        assertEquals(AppSessionState.LocalDemo, viewModel.state)
        assertEquals(0, repository.restoreCalls)
        assertEquals(0, repository.loginCalls)
    }

    @Test
    fun expiredSessionClearsSelectedStoreAndReturnsToLogin() = runTest {
        val selection = FakeSelectedStoreStore("store_a")
        val viewModel = SessionViewModel(FakeRepository(listOf(storeA)), selection, SavedStateHandle())

        viewModel.onSessionInvalidated()
        advanceUntilIdle()

        assertEquals(AppSessionState.Login, viewModel.state)
        assertEquals(null, selection.storeId)
    }

    private class FakeSelectedStoreStore(initialStoreId: String? = null) : SelectedStoreStore {
        override var storeId: String? = initialStoreId
    }

    private class FakeRepository(private val stores: List<StoreMembership>) : AuthRepository {
        var loginCalls = 0
        var restoreCalls = 0
        var logoutCalls = 0
        override suspend fun login(loginName: String, password: String): List<StoreMembership> { loginCalls += 1; return stores }
        override suspend fun restore(): List<StoreMembership> { restoreCalls += 1; return stores }
        override suspend fun logout() { logoutCalls += 1 }
    }
}
