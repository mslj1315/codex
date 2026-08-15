package com.restaurantops.content

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable fun StoryboardContextScreen(repository: StoryboardContextRepository, storeId: String, onSelected: (StoryboardContext) -> Unit) {
    var contexts by mutableStateOf<List<StoryboardContext>>(emptyList()); var error by mutableStateOf<String?>(null)
    LaunchedEffect(storeId) { runCatching { repository.list(storeId) }.onSuccess { contexts = it }.onFailure { error = "Video projects are unavailable right now." } }
    Column(Modifier.fillMaxSize().padding(16.dp)) { Text("Storyboard videos"); error?.let { Text(it) }; if (contexts.isEmpty() && error == null) Text("No confirmed storyboards are ready."); contexts.forEach { context -> Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) { TextButton(onClick = { onSelected(context) }) { Text(context.title) } } } }
}
