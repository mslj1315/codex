package com.restaurantops.onboarding

import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue

class StoreFactDraftTest {
    @Test
    fun `new draft starts without confirmed store facts`() {
        assertFalse(StoreFactDraft().isReadyForDiagnosis)
    }

    @Test
    fun `complete draft with positive average spend is ready for diagnosis`() {
        assertTrue(
            StoreFactDraft(
                storeName = "Noodle House",
                businessType = BusinessType.CHINESE_FULL_SERVICE_DINING,
                averageSpendCents = 4_500,
                currentGoal = "Improve weekday lunch throughput"
            ).isReadyForDiagnosis
        )
    }

    @Test
    fun `draft with zero average spend is not ready for diagnosis`() {
        assertFalse(completeDraft(averageSpendCents = 0).isReadyForDiagnosis)
    }

    @Test
    fun `draft with negative average spend is not ready for diagnosis`() {
        assertFalse(completeDraft(averageSpendCents = -100).isReadyForDiagnosis)
    }

    @Test
    fun `business types retain stable API wire values`() {
        assertEquals("chinese_dining", BusinessType.CHINESE_FULL_SERVICE_DINING.wireValue)
        assertEquals("quick_service", BusinessType.FAST_FOOD_SNACKS.wireValue)
        assertEquals("hotpot_bbq", BusinessType.HOT_POT_BARBECUE.wireValue)
        assertEquals("tea_coffee", BusinessType.TEA_BEVERAGES_COFFEE.wireValue)
        assertEquals("bakery_dessert", BusinessType.BAKERY_DESSERTS.wireValue)
    }

    private fun completeDraft(averageSpendCents: Long) = StoreFactDraft(
        storeName = "Noodle House",
        businessType = BusinessType.CHINESE_FULL_SERVICE_DINING,
        averageSpendCents = averageSpendCents,
        currentGoal = "Improve weekday lunch throughput"
    )
}
