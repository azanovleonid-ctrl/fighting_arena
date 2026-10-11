package com.fightingarena.app.ui

import android.app.Activity
import android.content.pm.ActivityInfo
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.dp
import com.fightingarena.app.BuildConfig
import com.fightingarena.app.data.UpdateState
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.arena.PartyRequest

private val Dark = darkColorScheme(primary = Color(0xFFE5533D), secondary = Color(0xFFF2B33D))
private val Light = lightColorScheme(primary = Color(0xFFB8321F), secondary = Color(0xFFB07A10))

@Composable
fun ArenaRoot(app: ArenaApp) {
    val loggedIn by app.session.loggedIn.collectAsState()
    val profile by app.session.profile.collectAsState()
    LaunchedEffect(Unit) { app.session.load() }
    LaunchedEffect(Unit) { app.updater.checkForUpdate() }
    val activity = LocalContext.current as? Activity
    // Login and menus are portrait; only the battle itself turns to landscape (see ArenaView).
    LaunchedEffect(Unit) { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT }

    val dark = (profile?.settings?.theme ?: "dark") == "dark"
    MaterialTheme(colorScheme = if (dark) Dark else Light) {
        Surface(Modifier.fillMaxSize()) {
            when (loggedIn) {
                null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                false -> AuthScreen(app)
                true -> MainNav(app)
            }
            UpdatePrompt(app)
        }
    }
}

@Composable
private fun MainNav(app: ArenaApp) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = "home") {
        composable("home") {
            HomeScreen(
                app,
                onFight = { mode -> nav.navigate("fight/$mode") },
                onCreateParty = { mode, together -> nav.navigate("party/$mode/create/${if (together) 1 else 0}") },
                onJoinParty = { mode, code -> nav.navigate("party/$mode/join/$code") },
                onHistory = { nav.navigate("history") },
                onSettings = { nav.navigate("settings") },
            )
        }
        composable("fight/{mode}") { entry ->
            GameScreen(app, mode = entry.arguments?.getString("mode") ?: "survival", onExit = { nav.popBackStack() })
        }
        composable("party/{mode}/{kind}/{arg}") { entry ->
            val args = entry.arguments
            val arg = args?.getString("arg").orEmpty()
            val party = if (args?.getString("kind") == "join") PartyRequest.Join(arg) else PartyRequest.Create(arg == "1")
            GameScreen(app, mode = args?.getString("mode") ?: "survival", party = party, onExit = { nav.popBackStack() })
        }
        composable("history") { HistoryScreen(app, onBack = { nav.popBackStack() }) }
        composable("settings") { SettingsScreen(app, onBack = { nav.popBackStack() }) }
    }
}

/** Offers a new version as soon as one is found; "Позже" hides it until the app is opened again. */
@Composable
private fun UpdatePrompt(app: ArenaApp) {
    val state by app.updater.state.collectAsState()
    var answered by rememberSaveable { mutableStateOf(-1) }
    val s = state
    val info = when (s) {
        is UpdateState.Available -> s.info
        is UpdateState.Downloading -> s.info
        else -> return
    }
    if (answered == info.versionCode && s !is UpdateState.Downloading) return
    AlertDialog(
        onDismissRequest = { if (s !is UpdateState.Downloading) answered = info.versionCode },
        title = { Text("Есть обновление") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Вышла версия ${info.versionName}, у вас ${BuildConfig.VERSION_NAME}. Обновить сейчас? Аккаунт и настройки сохранятся.")
                if (s is UpdateState.Downloading) {
                    Text("Скачиваем…")
                    if (s.progress >= 0f) LinearProgressIndicator(progress = { s.progress }, modifier = Modifier.fillMaxWidth())
                    else LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    answered = info.versionCode
                    app.updater.install(info)
                },
                enabled = s !is UpdateState.Downloading,
            ) { Text("Обновить") }
        },
        dismissButton = {
            if (s !is UpdateState.Downloading) TextButton(onClick = { answered = info.versionCode }) { Text("Позже") }
        },
    )
}
