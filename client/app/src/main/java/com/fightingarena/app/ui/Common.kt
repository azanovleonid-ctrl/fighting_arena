package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.ui.Alignment
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fightingarena.app.data.UpdateState
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.isUnauthorized
import com.fightingarena.app.data.userMessage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ArenaTopBar(title: String, onBack: (() -> Unit)? = null) {
    TopAppBar(
        title = { Text(title) },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад") }
            }
        },
    )
}

/** Runs an API call; signs out on an expired token and returns the error text otherwise. */
suspend fun <T> ArenaApp.call(block: suspend () -> T): Result<T> =
    runCatching { block() }.onFailure { if (it.isUnauthorized()) session.signOut() }

fun Result<*>.errorText(): String? = exceptionOrNull()?.userMessage()

/** "Обновить" card, shown only when a newer build is published. */
@Composable
fun UpdateBanner(app: ArenaApp) {
    val state by app.updater.state.collectAsState()
    val info = when (val s = state) {
        is UpdateState.Available -> s.info
        is UpdateState.Downloading -> s.info
        else -> return
    }
    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer),
    ) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Новая версия ${info.versionName}", Modifier.weight(1f))
            val s = state
            if (s is UpdateState.Downloading) {
                if (s.progress >= 0f) LinearProgressIndicator(progress = { s.progress }, modifier = Modifier.weight(1f))
                else LinearProgressIndicator(Modifier.weight(1f))
            } else {
                Button(onClick = { app.updater.install(info) }) { Text("Обновить") }
            }
        }
    }
}
