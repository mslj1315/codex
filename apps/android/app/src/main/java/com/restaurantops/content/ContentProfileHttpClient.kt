package com.restaurantops.content

import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

fun interface ContentProfileAuth { fun headers(): Map<String, String> }

class ContentProfileHttpClient(private val baseUrl: String, private val auth: ContentProfileAuth) : ContentProfileApi {
    override suspend fun getProfile(storeId: String) = profileRequest("GET", storeId, null)
    override suspend fun createProfile(storeId: String, profile: StoreContentProfile) = profileRequest("POST", storeId, profile.toRequest())
    override suspend fun updateProfile(storeId: String, profile: StoreContentProfile) = profileRequest("PUT", storeId, profile.toRequest())
    override suspend fun listOperatingStages(storeId: String): List<OperatingStage> = withContext(Dispatchers.IO) {
        val body = request("GET", stagesPath(storeId), null)
        JSONArray(body).let { array -> List(array.length()) { index -> array.getJSONObject(index).toStage() } }
    }
    override suspend fun createOperatingStage(storeId: String, stage: OperatingStage) = withContext(Dispatchers.IO) {
        JSONObject(request("POST", stagesPath(storeId), stage.toJson())).toStage()
    }

    private suspend fun profileRequest(method: String, storeId: String, body: ContentProfileRequest?): StoreContentProfile = withContext(Dispatchers.IO) {
        JSONObject(request(method, profilePath(storeId), body?.toJson())).toProfile()
    }

    private fun request(method: String, path: String, body: String?): String {
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 10_000; readTimeout = 10_000
            auth.headers().forEach { (key, value) -> setRequestProperty(key, value) }
            if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json"); outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) } }
        }
        val code = connection.responseCode
        val response = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
        connection.disconnect()
        if (code !in 200..299) throw IllegalStateException("Request failed ($code)")
        return response
    }

    private fun profilePath(storeId: String) = "/v1/stores/${storeId.encodePath()}/content-profile"
    private fun stagesPath(storeId: String) = "/v1/stores/${storeId.encodePath()}/operating-stages"
}

private fun StoreContentProfile.toRequest() = ContentProfileRequest(storeName, industryCode, categoryCode, categoryCustomName, provinceCode, cityCode, districtCode, detailedAddress, businessDistrictType, businessDistrictNote, operatingMode)
private fun ContentProfileRequest.toJson() = JSONObject().apply { put("storeName", storeName); put("industryCode", industryCode); put("categoryCode", categoryCode); put("categoryCustomName", categoryCustomName); put("provinceCode", provinceCode); put("cityCode", cityCode); put("districtCode", districtCode); put("detailedAddress", detailedAddress); put("businessDistrictType", businessDistrictType); put("businessDistrictNote", businessDistrictNote); put("operatingMode", operatingMode) }.toString()
private fun OperatingStage.toJson() = JSONObject().apply { put("effectiveDate", effectiveDate); put("primaryGoal", primaryGoal); put("secondaryGoal", secondaryGoal); put("note", note) }.toString()
private fun JSONObject.toProfile() = StoreContentProfile(getString("storeId"), getString("storeName"), getString("industryCode"), getString("categoryCode"), optString("categoryCustomName").takeUnless { it.isBlank() }, getString("provinceCode"), getString("cityCode"), getString("districtCode"), getString("detailedAddress"), getString("businessDistrictType"), optString("businessDistrictNote").takeUnless { it.isBlank() }, getString("operatingMode"), optString("enterpriseId").takeUnless { it.isBlank() }, optInt("version").takeIf { it > 0 })
private fun JSONObject.toStage() = OperatingStage(getString("effectiveDate"), getString("primaryGoal"), optString("secondaryGoal").takeUnless { it.isBlank() }, optString("note").takeUnless { it.isBlank() })
private fun String.encodePath() = URLEncoder.encode(this, Charsets.UTF_8.name()).replace("+", "%20")
