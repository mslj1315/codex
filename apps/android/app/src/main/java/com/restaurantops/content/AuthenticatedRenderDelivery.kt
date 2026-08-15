package com.restaurantops.content

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File

sealed class RenderDeliveryResult { data class Ready(val file: File): RenderDeliveryResult(); data class Unavailable(val message: String): RenderDeliveryResult() }
class AuthenticatedRenderDelivery(private val context: Context, private val baseUrl: String, private val client: OkHttpClient) {
    suspend fun output(store: String, task: String, shots: String, project: String, render: String) = fetch(storyboardRenderOutputPath(store, task, shots, project, render), "$render.mp4")
    suspend fun cover(store: String, task: String, shots: String, project: String, render: String, candidate: String) = fetch(storyboardCoverPath(store, task, shots, project, render, candidate), "$render-$candidate.jpg")
    private suspend fun fetch(path: String, name: String): RenderDeliveryResult = withContext(Dispatchers.IO) { val directory = File(context.cacheDir, "storyboard-renders").apply { mkdirs() }; directory.listFiles()?.filter { it.lastModified() < System.currentTimeMillis() - 86_400_000L }?.forEach(File::delete); val destination = File(directory, name.replace(Regex("[^A-Za-z0-9._-]"), "_")); val response = client.newCall(Request.Builder().url(baseUrl.trimEnd('/') + path).get().build()).execute(); response.use { when (it.code) { 404 -> RenderDeliveryResult.Unavailable("This render has expired or was deleted."); 401,403 -> RenderDeliveryResult.Unavailable("Video delivery is unavailable. Sign in again."); in 200..299 -> { val body = it.body ?: return@use RenderDeliveryResult.Unavailable("Video delivery is unavailable."); body.byteStream().use { input -> destination.outputStream().buffered().use { output -> input.copyTo(output, 64 * 1024) } }; RenderDeliveryResult.Ready(destination) }; else -> RenderDeliveryResult.Unavailable("Video delivery is unavailable.") } } }
    fun open(file: File, mime: String) { val uri = FileProvider.getUriForFile(context, "${context.packageName}.storyboard", file); context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
}
