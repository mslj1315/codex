package com.restaurantops.content

import java.net.HttpURLConnection
import java.net.URL

fun interface ContentProfileAuth { fun headers(): Map<String, String> }

class ContentProfileHttpClient(private val baseUrl: String, private val auth: ContentProfileAuth) : ContentProfileApi {
    override suspend fun getProfile(storeId: String) = request("GET", "/v1/stores/$storeId/content-profile", null).toProfile()
    override suspend fun createProfile(storeId: String, profile: StoreContentProfile) = request("POST", "/v1/stores/$storeId/content-profile", profile.toRequest()).toProfile()
    override suspend fun updateProfile(storeId: String, profile: StoreContentProfile) = request("PUT", "/v1/stores/$storeId/content-profile", profile.toRequest()).toProfile()
    override suspend fun listOperatingStages(storeId: String): List<OperatingStage> = emptyList()
    override suspend fun createOperatingStage(storeId: String, stage: OperatingStage) = stage

    private fun request(method: String, path: String, body: ContentProfileRequest?): ContentProfileResponse {
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 10_000; readTimeout = 10_000
            auth.headers().forEach { (key, value) -> setRequestProperty(key, value) }
            if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json"); outputStream.use { it.write(body.toJson().toByteArray()) } }
        }
        if (connection.responseCode !in 200..299) throw IllegalStateException("content profile request failed: ${connection.responseCode}")
        return ContentProfileResponse(StoreContentProfile("", "", "", "", "", "", "", "", "", ""), false, emptyList())
    }
}

private fun StoreContentProfile.toRequest() = ContentProfileRequest(storeName, industryCode, categoryCode, categoryCustomName, provinceCode, cityCode, districtCode, detailedAddress, businessDistrictType, businessDistrictNote, operatingMode)
private fun ContentProfileResponse.toProfile() = profile
private fun ContentProfileRequest.toJson() = "{\"storeName\":\"${storeName.escape()}\",\"industryCode\":\"$industryCode\",\"categoryCode\":\"$categoryCode\",\"provinceCode\":\"$provinceCode\",\"cityCode\":\"$cityCode\",\"districtCode\":\"$districtCode\",\"detailedAddress\":\"${detailedAddress.escape()}\",\"businessDistrictType\":\"$businessDistrictType\",\"operatingMode\":\"$operatingMode\"}"
private fun String.escape() = replace("\\", "\\\\").replace("\"", "\\\"")
