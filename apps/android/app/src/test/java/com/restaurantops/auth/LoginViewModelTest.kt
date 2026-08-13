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
class LoginViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun blankCredentialsDoNotCallTheRepository() = runTest {
        val repository = FakeAuthRepository()
        val viewModel = LoginViewModel(repository, SavedStateHandle())

        viewModel.loginName = " "
        viewModel.password = ""
        viewModel.submit()

        assertEquals(LoginUiState.Error("请输入账号和密码"), viewModel.uiState)
        assertEquals(0, repository.loginCalls)
    }

    @Test
    fun successfulLoginLoadsTheEnabledStoresAndClearsThePassword() = runTest {
        val expectedStores = listOf(StoreMembership("ent_a", "store_a", StoreRole.OWNER))
        val repository = FakeAuthRepository(stores = expectedStores)
        val viewModel = LoginViewModel(repository, SavedStateHandle())

        viewModel.loginName = "owner"
        viewModel.password = "password"
        viewModel.submit()
        advanceUntilIdle()

        assertEquals(LoginUiState.Success(expectedStores), viewModel.uiState)
        assertEquals("", viewModel.password)
        assertEquals(1, repository.loginCalls)
    }

    @Test
    fun rejectedLoginSurfacesAStableMessageAndClearsThePassword() = runTest {
        val repository = FakeAuthRepository(loginFailure = AuthRequestException(401, "Authentication required"))
        val viewModel = LoginViewModel(repository, SavedStateHandle())

        viewModel.loginName = "owner"
        viewModel.password = "wrong"
        viewModel.submit()
        advanceUntilIdle()

        assertEquals(LoginUiState.Error("账号或密码不正确"), viewModel.uiState)
        assertEquals("", viewModel.password)
    }

    @Test
    fun consumedSuccessfulLoginReturnsToIdleWithoutClearingTheLoginName() = runTest {
        val repository = FakeAuthRepository(stores = listOf(StoreMembership("ent_a", "store_a", StoreRole.OWNER)))
        val viewModel = LoginViewModel(repository, SavedStateHandle())
        viewModel.loginName = "owner"
        viewModel.password = "password"

        viewModel.submit()
        advanceUntilIdle()
        viewModel.clearConsumedResult()

        assertEquals(LoginUiState.Idle, viewModel.uiState)
        assertEquals("owner", viewModel.loginName)
        assertEquals("", viewModel.password)
    }

    private class FakeAuthRepository(
        private val stores: List<StoreMembership> = emptyList(),
        private val loginFailure: Throwable? = null
    ) : AuthRepository {
        var loginCalls = 0

        override suspend fun login(loginName: String, password: String): List<StoreMembership> {
            loginCalls += 1
            loginFailure?.let { throw it }
            return stores
        }

        override suspend fun restore(): List<StoreMembership> = stores

        override suspend fun logout() = Unit
    }
}
