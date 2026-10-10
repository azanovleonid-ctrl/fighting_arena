package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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

@Composable
fun HpBar(name: String, hp: Int, maxHp: Int, modifier: Modifier = Modifier) {
    Column(modifier) {
        Text("$name  $hp/$maxHp", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(4.dp))
        LinearProgressIndicator(
            progress = { if (maxHp > 0) hp.toFloat() / maxHp else 0f },
            modifier = Modifier.fillMaxWidth().height(10.dp),
        )
    }
}

/** Runs an API call; signs out on an expired token and returns the error text otherwise. */
suspend fun <T> ArenaApp.call(block: suspend () -> T): Result<T> =
    runCatching { block() }.onFailure { if (it.isUnauthorized()) session.signOut() }

fun Result<*>.errorText(): String? = exceptionOrNull()?.userMessage()
