package com.fightingarena.app.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
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
