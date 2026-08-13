package com.restaurantops.content

data class StoreContentProfile(
    val storeId: String,
    val storeName: String,
    val industryCode: String,
    val categoryCode: String,
    val categoryCustomName: String? = null,
    val provinceCode: String,
    val cityCode: String,
    val districtCode: String,
    val detailedAddress: String,
    val businessDistrictType: String,
    val businessDistrictNote: String? = null,
    val operatingMode: String
) {
    fun missingRequiredFields(): List<String> = buildList {
        if (storeName.isBlank()) add("storeName")
        if (industryCode.isBlank()) add("industryCode")
        if (categoryCode.isBlank()) add("categoryCode")
        if (provinceCode.isBlank()) add("provinceCode")
        if (cityCode.isBlank()) add("cityCode")
        if (districtCode.isBlank()) add("districtCode")
        if (detailedAddress.isBlank()) add("detailedAddress")
        if (businessDistrictType.isBlank()) add("businessDistrictType")
        if (operatingMode.isBlank()) add("operatingMode")
    }
}

data class OperatingStage(
    val effectiveDate: String,
    val primaryGoal: String,
    val secondaryGoal: String? = null,
    val note: String? = null
)
