package com.restaurantops.onboarding

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel

class StoreOnboardingViewModel(
    private val savedStateHandle: SavedStateHandle
) : ViewModel() {
    var stepIndex by mutableIntStateOf(savedStateHandle[STEP_INDEX] ?: 0)
        private set

    var draft by mutableStateOf(
        StoreFactDraft(
            storeName = savedStateHandle[STORE_NAME] ?: "",
            businessType = BusinessType.fromWireValue(savedStateHandle[BUSINESS_TYPE]),
            averageSpendCents = savedStateHandle[AVERAGE_SPEND_CENTS],
            currentGoal = savedStateHandle[CURRENT_GOAL] ?: ""
        )
    )
        private set

    var averageSpendInput by mutableStateOf(savedStateHandle[AVERAGE_SPEND_INPUT] ?: "")
        private set

    var isPreviewing by mutableStateOf(savedStateHandle[IS_PREVIEWING] ?: false)
        private set

    fun goBack() = setStep((stepIndex - 1).coerceAtLeast(0))

    fun goNext() = setStep((stepIndex + 1).coerceAtMost(OnboardingStep.entries.lastIndex))

    fun updateStoreName(value: String) = updateDraft { copy(storeName = value) }

    fun updateBusinessType(value: BusinessType) = updateDraft { copy(businessType = value) }

    fun updateAverageSpendYuan(value: String) {
        averageSpendInput = value
        savedStateHandle[AVERAGE_SPEND_INPUT] = value
        updateDraft { copy(averageSpendCents = yuanToCents(value)) }
    }

    fun updateCurrentGoal(value: String) = updateDraft { copy(currentGoal = value) }

    fun previewLocally() {
        if (draft.isReadyForDiagnosis) {
            isPreviewing = true
            savedStateHandle[IS_PREVIEWING] = true
        }
    }

    fun exitPreview() {
        isPreviewing = false
        savedStateHandle[IS_PREVIEWING] = false
    }

    private fun setStep(value: Int) {
        stepIndex = value
        savedStateHandle[STEP_INDEX] = value
    }

    private fun updateDraft(transform: StoreFactDraft.() -> StoreFactDraft) {
        draft = draft.transform()
        savedStateHandle[STORE_NAME] = draft.storeName
        savedStateHandle[BUSINESS_TYPE] = draft.businessType?.wireValue
        savedStateHandle[AVERAGE_SPEND_CENTS] = draft.averageSpendCents
        savedStateHandle[CURRENT_GOAL] = draft.currentGoal
    }

    private fun yuanToCents(value: String): Long? {
        val yuan = value.trim().toLongOrNull() ?: return null
        if (yuan <= 0 || yuan > Long.MAX_VALUE / CENTS_PER_YUAN) return null
        return yuan * CENTS_PER_YUAN
    }

    private companion object {
        const val CENTS_PER_YUAN = 100L
        const val STEP_INDEX = "onboarding_step_index"
        const val STORE_NAME = "onboarding_store_name"
        const val BUSINESS_TYPE = "onboarding_business_type"
        const val AVERAGE_SPEND_CENTS = "onboarding_average_spend_cents"
        const val AVERAGE_SPEND_INPUT = "onboarding_average_spend_input"
        const val CURRENT_GOAL = "onboarding_current_goal"
        const val IS_PREVIEWING = "onboarding_is_previewing"
    }
}
