package com.restaurantops.auth

import androidx.lifecycle.SavedStateHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
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
class PasswordChangeViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before fun setUp() { Dispatchers.setMain(dispatcher) }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test
    fun successfulChangeClearsAllPasswordFieldsAndReturnsAnAuthenticatedSession() = runTest {
        val repository = FakeRepository()
        val viewModel = PasswordChangeViewModel(repository, SavedStateHandle())
        viewModel.currentPassword = "temporary-password"
        viewModel.newPassword = "a-new-safe-password"
        viewModel.confirmation = "a-new-safe-password"

        viewModel.submit("13800138000")
        advanceUntilIdle()

        assertEquals("13800138000", repository.loginName)
        assertEquals("", viewModel.currentPassword)
        assertEquals("", viewModel.newPassword)
        assertEquals("", viewModel.confirmation)
        assertEquals(PasswordChangeUiState.Success(AuthenticatedSession(listOf(StoreMembership("ent", "store", StoreRole.OWNER)), false)), viewModel.uiState)
    }

    @Test
    fun mismatchedNewPasswordsNeverCallTheRepository() = runTest {
        val repository = FakeRepository()
        val viewModel = PasswordChangeViewModel(repository, SavedStateHandle())
        viewModel.currentPassword = "temporary-password"
        viewModel.newPassword = "a-new-safe-password"
        viewModel.confirmation = "different-safe-password"

        viewModel.submit("13800138000")

        assertEquals(0, repository.changeCalls)
        assertEquals("", viewModel.currentPassword)
        assertEquals("", viewModel.newPassword)
        assertEquals("", viewModel.confirmation)
    }

    @Test
    fun cancelledChangeKeepsCancellationNeutralInsteadOfShowingAnError() = runTest {
        val repository = FakeRepository(changeFailure = CancellationException("cancelled"))
        val viewModel = PasswordChangeViewModel(repository, SavedStateHandle())
        viewModel.currentPassword = "temporary-password"
        viewModel.newPassword = "a-new-safe-password"
        viewModel.confirmation = "a-new-safe-password"

        viewModel.submit("13800138000")
        advanceUntilIdle()

        assertEquals(PasswordChangeUiState.Loading, viewModel.uiState)
    }

    private class FakeRepository(private val changeFailure: Throwable? = null) : AuthRepository {
        var loginName: String? = null
        var changeCalls = 0
        override suspend fun login(loginName: String, password: String) = AuthenticatedSession(emptyList(), false)
        override suspend fun restore() = AuthenticatedSession(emptyList(), false)
        override suspend fun changePassword(loginName: String, currentPassword: String, newPassword: String): AuthenticatedSession {
            this.loginName = loginName
            changeCalls += 1
            changeFailure?.let { throw it }
            return AuthenticatedSession(listOf(StoreMembership("ent", "store", StoreRole.OWNER)), false)
        }
        override suspend fun logout() = Unit
    }
}
