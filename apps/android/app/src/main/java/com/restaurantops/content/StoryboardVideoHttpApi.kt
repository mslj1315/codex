package com.restaurantops.content

import android.content.ContentResolver
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

fun storyboardProjectPath(store: String, task: String, shots: String, project: String) = "/v1/stores/$store/content-tasks/$task/shot-lists/$shots/projects/$project"
fun storyboardRenderOutputPath(store: String, task: String, shots: String, project: String, render: String) = "${storyboardProjectPath(store, task, shots, project)}/renders/$render/output"
fun storyboardCoverPath(store: String, task: String, shots: String, project: String, render: String, candidate: String) = "${storyboardProjectPath(store, task, shots, project)}/renders/$render/cover-candidates/$candidate"

interface StoryboardWireApi {
    @GET("v1/stores/{store}/storyboard-contexts") suspend fun contexts(@Path("store") store: String): Map<String, Any>
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/assets/upload-grants") suspend fun grant(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Body body: Map<String, Any>): Map<String, Any>
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/assets/{asset}/complete") suspend fun complete(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("asset") asset: String): Map<String, Any>
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects") suspend fun project(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String): Map<String, Any>
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects/{project}/versions") suspend fun save(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("project") project: String, @Body body: Map<String, Any?>): Map<String, Any>
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects/{project}/renders") suspend fun render(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("project") project: String, @Body body: Map<String, String>): Map<String, Any>
    @GET("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects/{project}/renders") suspend fun renders(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("project") project: String): Map<String, Any>
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects/{project}/renders/{render}/cancel") suspend fun cancel(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("project") project: String, @Path("render") render: String): Map<String, Any>
    @DELETE("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects/{project}/renders/{render}") suspend fun delete(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("project") project: String, @Path("render") render: String)
    @POST("v1/stores/{store}/content-tasks/{task}/shot-lists/{shots}/projects/{project}/renders/{render}/cover-selection") suspend fun cover(@Path("store") store: String, @Path("task") task: String, @Path("shots") shots: String, @Path("project") project: String, @Path("render") render: String, @Body body: Map<String, String>): Map<String, Any>
}
data class StoryboardContext(val taskId: String, val shotListId: String, val title: String, val projectId: String? = null)
class StoryboardContextRepository(private val api: StoryboardWireApi) { suspend fun list(storeId: String) = ((api.contexts(storeId)["contexts"] as? List<Map<String, Any>>).orEmpty()).map { item -> val project = item["project"] as? Map<String, Any>; StoryboardContext(item["taskId"] as String, item["shotListId"] as String, item["title"] as String, project?.get("id") as? String) } }

class RetrofitStoryboardVideoApi(private val api: StoryboardWireApi) : StoryboardVideoApi {
    override suspend fun createUploadGrant(storeId: String, taskId: String, shotListId: String, source: GalleryVideo)=uploadGrantFrom(api.grant(storeId,taskId,shotListId,mapOf("expectedSizeBytes" to source.sizeBytes,"contentType" to "video/mp4")))
    override suspend fun completeUpload(storeId: String, taskId: String, shotListId: String, assetId: String)=uploadedAssetFrom(api.complete(storeId,taskId,shotListId,assetId))
    override suspend fun createProject(storeId:String,taskId:String,shotListId:String)=api.project(storeId,taskId,shotListId).draft()
    override suspend fun loadProject(storeId:String,taskId:String,shotListId:String,projectId:String)=throw UnsupportedOperationException("Project recovery is loaded from create/project response")
    override suspend fun saveProject(storeId:String,taskId:String,shotListId:String,draft:StoryboardDraft,finalize:Boolean)=api.save(storeId,taskId,shotListId,draft.projectId,mapOf("slots" to draft.slots.map { mapOf("slotId" to it.id,"kind" to it.kind,"assetId" to it.assetId,"order" to it.order,"trimStartSeconds" to it.trimStartSeconds,"trimEndSeconds" to it.trimEndSeconds,"muted" to it.muted,"subtitleEnabled" to it.subtitleEnabled,"subtitleText" to it.subtitleText) },"coverAssetId" to draft.coverAssetId,"coverFrameOffsetSeconds" to draft.coverFrameOffsetSeconds,"coverTitle" to draft.coverTitle,"finalize" to finalize)).draft()
    override suspend fun createRender(storeId:String,taskId:String,shotListId:String,projectId:String,kind:String)=api.render(storeId,taskId,shotListId,projectId,mapOf("kind" to kind)).render()
    override suspend fun listRenders(storeId:String,taskId:String,shotListId:String,projectId:String)=(api.renders(storeId,taskId,shotListId,projectId)["renders"] as List<Map<String,Any>>).map { it.render() }
    override suspend fun cancelRender(storeId:String,taskId:String,shotListId:String,projectId:String,renderId:String)=api.cancel(storeId,taskId,shotListId,projectId,renderId).render()
    override suspend fun deleteRender(storeId:String,taskId:String,shotListId:String,projectId:String,renderId:String)=api.delete(storeId,taskId,shotListId,projectId,renderId)
    override suspend fun selectCover(storeId:String,taskId:String,shotListId:String,projectId:String,renderId:String,candidateId:String,title:String)=coverSelectionFrom(api.cover(storeId,taskId,shotListId,projectId,renderId,mapOf("candidateId" to candidateId,"title" to title)))
}
fun uploadGrantFrom(m: Map<String, Any>): UploadGrant { val upload=m["upload"] as Map<String, Any>; return UploadGrant(m["assetId"] as String, upload["url"] as String, m["expiresAt"] as String) }
fun uploadedAssetFrom(m: Map<String, Any>)=UploadedAsset(m["id"] as String,"Accepted video",(m["durationSeconds"] as? Number)?.toInt()?:0)
fun coverSelectionFrom(m: Map<String, Any>)=CoverSelection(m["selectedCoverCandidateId"] as String,m["selectedCoverTitle"] as String)
class ContentResolverDirectVideoUploader(private val resolver: ContentResolver, private val client: OkHttpClient = OkHttpClient()) : DirectVideoUploader { override suspend fun upload(grant: UploadGrant, source: GalleryVideo) = withContext(Dispatchers.IO) { val body = object : RequestBody() { override fun contentType() = "video/mp4".toMediaType(); override fun contentLength() = source.sizeBytes; override fun writeTo(sink: BufferedSink) { resolver.openInputStream(Uri.parse(source.id))!!.use { input -> sink.writeAll(input.source()) } } }; client.newCall(Request.Builder().url(grant.uploadUrl).put(body).build()).execute().use { check(it.isSuccessful) } } }
private fun Map<String,Any>.draft(): StoryboardDraft { val slots=(this["slots"] as? List<Map<String,Any>>).orEmpty().map { StoryboardSlot(it["slotId"] as String,(it["order"] as Number).toInt(),it["kind"] as String, it["assetId"] as? String,(it["trimStartSeconds"] as? Number)?.toInt()?:0,(it["trimEndSeconds"] as? Number)?.toInt()?:0,it["muted"] as? Boolean?:false,it["subtitleEnabled"] as? Boolean?:true,it["subtitleText"] as? String?:"") }; return StoryboardDraft(this["id"] as String,(this["version"] as Number).toInt(),slots,this["coverAssetId"] as? String,(this["coverFrameOffsetSeconds"] as? Number)?.toInt(),this["coverTitle"] as? String?:"",this["status"] as? String?:"draft") }
private fun Map<String,Any>.render(): StoryboardRender { val candidates=(this["coverCandidates"] as? List<Map<String,Any>>).orEmpty().map { (it["id"] ?: it["artifactId"]).toString() }; return StoryboardRender(this["id"] as String,this["kind"] as String,RenderState.valueOf((this["state"] as String).replaceFirstChar { it.uppercase() }),this["expiresAt"] as? String,candidates) }
