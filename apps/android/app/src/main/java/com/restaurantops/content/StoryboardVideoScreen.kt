package com.restaurantops.content

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import android.media.MediaMetadataRetriever

@Composable
fun StoryboardVideoScreen(viewModel: StoryboardVideoViewModel, storeId: String, taskId: String, shotListId: String, onDeliver: (StoryboardRender, String?) -> Unit = { _, _ -> }, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        viewModel.selectSources(uris.mapNotNull { uri ->
            runCatching {
                val size = context.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length }.takeIf { it != null && it >= 0 } ?: 0L
                val duration = MediaMetadataRetriever().use { retriever -> retriever.setDataSource(context, uri); ((retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L) / 1000L).toInt() }
                GalleryVideo(uri.toString(), uri.lastPathSegment ?: "video.mp4", size, duration)
            }.getOrNull()
        })
    }
    val state = viewModel.state
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Storyboard video", style = MaterialTheme.typography.titleLarge)
        Text("Choose up to 20 videos. Each may be up to 500 MB; all sources may total 10 minutes.")
        Button(onClick = { picker.launch(arrayOf("video/*")) }) { Text("Choose videos") }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        state.uploads.forEach { item ->
            Card(Modifier.fillMaxWidth()) { Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(item.source.displayName, Modifier.weight(1f)); Text(item.state.name)
                if (item.state == UploadState.Selected || item.state == UploadState.ReadyToRetry) Button(onClick = { viewModel.upload(storeId, taskId, shotListId, item.source.id) }) { Text("Upload") }
                if (item.state == UploadState.Failed) TextButton(onClick = { viewModel.recoverUpload(item.source.id) }) { Text("Retry") }
            } }
        }
        if (state.draft == null) Button(onClick = { viewModel.createProject(storeId, taskId, shotListId) }) { Text("Start confirmed storyboard") }
        state.draft?.let { draft ->
            Text("Slots", style = MaterialTheme.typography.titleMedium)
            val acceptedAssets = state.uploads.filter { it.state == UploadState.Uploaded && it.assetId != null }
            draft.slots.sortedBy { it.order }.forEach { slot -> SlotEditor(slot, acceptedAssets, viewModel::updateSlot) }
            TextButton(onClick = viewModel::addSupplementalSlot) { Text("Add supplemental slot") }
            OutlinedTextField(value = draft.coverTitle, onValueChange = { viewModel.updateCover(draft.coverAssetId, draft.coverFrameOffsetSeconds, it) }, label = { Text("Short cover title") }, modifier = Modifier.fillMaxWidth())
            Text("Choose one of the actual frame candidates returned after a successful final render.")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Button(onClick = { viewModel.requestRender(storeId, taskId, shotListId, "preview") }, enabled = draft.isRenderable()) { Text("Create preview") }; Button(onClick = { viewModel.requestRender(storeId, taskId, shotListId, "final") }, enabled = draft.isRenderable()) { Text("Create final") } }
            TextButton(onClick = { viewModel.refreshRenders(storeId, taskId, shotListId) }) { Text("Refresh render status") }
        }
        state.renders.forEach { render -> Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) { Text("${render.kind} - ${render.state}"); Text(renderExpiryMessage(render.kind)); if (render.canCancel) { TextButton(onClick = { viewModel.cancelRender(storeId, taskId, shotListId, render.id) }) { Text("Cancel render") } }; if (render.state == RenderState.Succeeded) { TextButton(onClick = { onDeliver(render, null) }) { Text("Preview / download") }; TextButton(onClick = { viewModel.deleteRender(storeId, taskId, shotListId, render.id) }) { Text("Delete output") }; if (render.kind == "final") render.coverCandidates.forEachIndexed { index, candidate -> TextButton(onClick = { onDeliver(render, candidate) }) { Text("Preview real frame ${index + 1}") }; TextButton(onClick = { viewModel.selectCover(storeId, taskId, shotListId, render.id, candidate, state.draft?.coverTitle.orEmpty()) }) { Text("Use real frame ${index + 1} as cover") } } } } }
        Text("Publish in Douyin manually after downloading. This editor has no publish action.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable private fun SlotEditor(slot: StoryboardSlot, assets: List<UploadItem>, onChange: (StoryboardSlot) -> Unit) {
    Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Slot ${slot.order}")
        assets.forEach { asset -> TextButton(onClick = { onChange(slot.copy(assetId = asset.assetId)) }) { Text(if (slot.assetId == asset.assetId) "Selected: ${asset.source.displayName}" else "Use ${asset.source.displayName}") } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { TextButton(onClick = { onChange(slot.copy(order = (slot.order - 1).coerceAtLeast(1))) }) { Text("Move earlier") }; TextButton(onClick = { onChange(slot.copy(order = slot.order + 1)) }) { Text("Move later") } }
        OutlinedTextField(value = slot.trimStartSeconds.toString(), onValueChange = { onChange(slot.copy(trimStartSeconds = it.toIntOrNull() ?: slot.trimStartSeconds)) }, label = { Text("Trim start seconds") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = slot.trimEndSeconds.toString(), onValueChange = { onChange(slot.copy(trimEndSeconds = it.toIntOrNull() ?: slot.trimEndSeconds)) }, label = { Text("Trim end seconds") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(value = slot.subtitleText, onValueChange = { onChange(slot.copy(subtitleText = it)) }, label = { Text("Subtitle") }, modifier = Modifier.fillMaxWidth())
        TextButton(onClick = { onChange(slot.copy(muted = !slot.muted)) }) { Text(if (slot.muted) "Original audio muted" else "Mute original audio") }
        TextButton(onClick = { onChange(slot.copy(subtitleEnabled = !slot.subtitleEnabled)) }) { Text(if (slot.subtitleEnabled) "Subtitle enabled" else "Subtitle disabled") }
    } }
}
