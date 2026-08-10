package com.restaurantops.onboarding

import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StoreOnboardingViewModelTest {
    @Test
    fun `seeded saved state restores draft step spend input and preview`() {
        val viewModel = StoreOnboardingViewModel(
            SavedStateHandle(
                mapOf(
                    "onboarding_step_index" to 3,
                    "onboarding_store_name" to "Tea Room",
                    "onboarding_business_type" to "tea_coffee",
                    "onboarding_average_spend_cents" to 2_800L,
                    "onboarding_average_spend_input" to "28",
                    "onboarding_current_goal" to "Increase morning traffic",
                    "onboarding_is_previewing" to true
                )
            )
        )

        assertEquals(3, viewModel.stepIndex)
        assertEquals("Tea Room", viewModel.draft.storeName)
        assertEquals(BusinessType.TEA_BEVERAGES_COFFEE, viewModel.draft.businessType)
        assertEquals(2_800L, viewModel.draft.averageSpendCents)
        assertEquals("28", viewModel.averageSpendInput)
        assertEquals("Increase morning traffic", viewModel.draft.currentGoal)
        assertTrue(viewModel.isPreviewing)
    }

    @Test
    fun `update paths persist wire values and preview can return to editing`() {
        val handle = SavedStateHandle()
        val viewModel = StoreOnboardingViewModel(handle)

        viewModel.updateStoreName("Bakery Lane")
        viewModel.updateBusinessType(BusinessType.BAKERY_DESSERTS)
        viewModel.updateAverageSpendYuan("52")
        viewModel.updateCurrentGoal("Raise pre-order conversion")
        repeat(3) { viewModel.goNext() }
        viewModel.previewLocally()

        assertEquals(3, handle.get<Int>("onboarding_step_index"))
        assertEquals("bakery_dessert", handle.get<String>("onboarding_business_type"))
        assertEquals(5_200L, handle.get<Long>("onboarding_average_spend_cents"))
        assertTrue(viewModel.isPreviewing)

        viewModel.exitPreview()

        assertFalse(viewModel.isPreviewing)
        assertFalse(handle.get<Boolean>("onboarding_is_previewing") ?: true)

        val restoredViewModel = StoreOnboardingViewModel(handle)
        assertEquals(3, restoredViewModel.stepIndex)
        assertEquals("Bakery Lane", restoredViewModel.draft.storeName)
        assertEquals(BusinessType.BAKERY_DESSERTS, restoredViewModel.draft.businessType)
        assertEquals("52", restoredViewModel.averageSpendInput)
        assertFalse(restoredViewModel.isPreviewing)
    }

    @Test
    fun `zero negative and overflow yuan values are rejected`() {
        val viewModel = StoreOnboardingViewModel(SavedStateHandle())
        viewModel.updateStoreName("Noodle House")
        viewModel.updateBusinessType(BusinessType.CHINESE_FULL_SERVICE_DINING)
        viewModel.updateCurrentGoal("Improve lunch throughput")

        listOf("0", "-1", Long.MAX_VALUE.toString()).forEach { input ->
            viewModel.updateAverageSpendYuan(input)

            assertNull(viewModel.draft.averageSpendCents)
            assertFalse(viewModel.draft.isReadyForDiagnosis)
        }
    }
}
