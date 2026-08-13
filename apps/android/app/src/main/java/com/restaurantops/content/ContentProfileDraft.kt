package com.restaurantops.content

data class ContentProfileDraft(
    val storeName: String = "", val industryCode: String = "", val categoryCode: String = "",
    val categoryCustomName: String = "", val provinceCode: String = "", val cityCode: String = "",
    val districtCode: String = "", val detailedAddress: String = "", val businessDistrictType: String = "",
    val businessDistrictNote: String = "", val operatingMode: String = ""
) {
    val isComplete: Boolean get() = toProfile("draft").missingRequiredFields().isEmpty()

    fun toProfile(storeId: String) = StoreContentProfile(
        storeId, storeName, industryCode, categoryCode, categoryCustomName.takeIf { it.isNotBlank() },
        provinceCode, cityCode, districtCode, detailedAddress, businessDistrictType,
        businessDistrictNote.takeIf { it.isNotBlank() }, operatingMode
    )
}
