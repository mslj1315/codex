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
        JSONObject(request(method, profilePath(storeId), body?.toJson())).toProfileResponse().profile
    }

    private fun request(method: String, path: String, body: String?): String {
        var connection: HttpURLConnection? = null
        try {
            if (baseUrl.isBlank()) throw ContentProfileHttpException("endpoint unavailable")
            connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
                requestMethod = method; connectTimeout = 10_000; readTimeout = 10_000
                auth.headers().forEach { (key, value) -> setRequestProperty(key, value) }
                if (body != null) { doOutput = true; setRequestProperty("Content-Type", "application/json"); outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) } }
            }
            val activeConnection = connection ?: throw ContentProfileHttpException("connection unavailable")
            val code = activeConnection.responseCode
            val response = (if (code in 200..299) activeConnection.inputStream else activeConnection.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw ContentProfileHttpException("Request failed ($code)")
            return response
        } catch (error: ContentProfileHttpException) { throw error }
        catch (_: Exception) { throw ContentProfileHttpException("network failure") }
        finally { connection?.disconnect() }
    }

    private fun profilePath(storeId: String) = "/v1/stores/${storeId.encodePath()}/content-profile"
    private fun stagesPath(storeId: String) = "/v1/stores/${storeId.encodePath()}/operating-stages"
}

class ContentProfileHttpException(message: String) : RuntimeException(message) {
    val neutralMessage: String get() = "暂时无法连接内容服务，请稍后重试"
}

fun contentProfileErrorMessage(error: Throwable, fallback: String): String =
    (error as? ContentProfileHttpException)?.neutralMessage ?: fallback

private fun StoreContentProfile.toRequest() = ContentProfileRequest(storeName, industryCode, categoryCode, categoryCustomName, provinceCode, cityCode, districtCode, detailedAddress, businessDistrictType, businessDistrictNote, operatingMode)
private fun ContentProfileRequest.toJson() = JSONObject().apply { put("storeName", storeName); put("industryCode", industryCode); put("categoryCode", categoryCode); put("categoryCustomName", categoryCustomName); put("provinceCode", provinceCode); put("cityCode", cityCode); put("districtCode", districtCode); put("detailedAddress", detailedAddress); put("businessDistrictType", businessDistrictType); put("businessDistrictNote", businessDistrictNote); put("operatingMode", operatingMode) }.toString()
private fun OperatingStage.toJson() = JSONObject().apply { put("effectiveDate", effectiveDate); put("primaryGoal", primaryGoal); put("secondaryGoal", secondaryGoal); put("note", note) }.toString()
private fun JSONObject.toProfileResponse(): ContentProfileResponse {
    val completeness = optJSONObject("completeness")
    val missing = completeness?.optJSONArray("missing")?.let { array -> List(array.length()) { index -> array.getString(index) } }.orEmpty()
    val required = completeness?.optBoolean("required") ?: false
    return ContentProfileResponse(StoreContentProfile(getString("storeId"), getString("storeName"), getString("industryCode"), getString("categoryCode"), optString("categoryCustomName").takeUnless { it.isBlank() }, getString("provinceCode"), getString("cityCode"), getString("districtCode"), getString("detailedAddress"), getString("businessDistrictType"), optString("businessDistrictNote").takeUnless { it.isBlank() }, getString("operatingMode"), optString("enterpriseId").takeUnless { it.isBlank() }, optInt("version").takeIf { it > 0 }, required, missing), required, missing)
}
private fun JSONObject.toStage() = OperatingStage(getString("effectiveDate"), getString("primaryGoal"), optString("secondaryGoal").takeUnless { it.isBlank() }, optString("note").takeUnless { it.isBlank() })
private fun String.encodePath() = URLEncoder.encode(this, Charsets.UTF_8.name()).replace("+", "%20")
