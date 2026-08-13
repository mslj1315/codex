package com.restaurantops.onboarding

enum class BusinessType(val wireValue: String, val displayName: String) {
    CHINESE_FULL_SERVICE_DINING("chinese_dining", "中式正餐"),
    FAST_FOOD_SNACKS("quick_service", "快餐小吃"),
    HOT_POT_BARBECUE("hotpot_bbq", "火锅烧烤"),
    TEA_BEVERAGES_COFFEE("tea_coffee", "茶饮咖啡"),
    BAKERY_DESSERTS("bakery_dessert", "烘焙甜品");

    companion object {
        fun fromWireValue(value: String?): BusinessType? =
            entries.firstOrNull { it.wireValue == value }
    }
}

enum class OnboardingStep(val title: String) {
    BASICS("门店基础"),
    POSITIONING("经营定位"),
    OPERATIONS("经营数据"),
    GOAL("本期目标")
}

data class StoreFactDraft(
    val storeName: String = "",
    val businessType: BusinessType? = null,
    val averageSpendCents: Long? = null,
    val currentGoal: String = ""
) {
    val isReadyForDiagnosis: Boolean
        get() = storeName.isNotBlank() &&
            businessType != null &&
            averageSpendCents != null && averageSpendCents > 0 &&
            currentGoal.isNotBlank()
}
