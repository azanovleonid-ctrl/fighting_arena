package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Box
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
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.fightingarena.app.ArenaApp

private val Dark = darkColorScheme(primary = Color(0xFFE5533D), secondary = Color(0xFFF2B33D))
private val Light = lightColorScheme(primary = Color(0xFFB8321F), secondary = Color(0xFFB07A10))

@Composable
fun ArenaRoot(app: ArenaApp) {
    val loggedIn by app.session.loggedIn.collectAsState()
    val profile by app.session.profile.collectAsState()
    LaunchedEffect(Unit) { app.session.load() }

    val dark = (profile?.settings?.theme ?: "dark") == "dark"
    MaterialTheme(colorScheme = if (dark) Dark else Light) {
        Surface(Modifier.fillMaxSize()) {
            when (loggedIn) {
                null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                false -> AuthScreen(app)
                true -> MainNav(app)
            }
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
                onFight = { nav.navigate("fight") },
                onHistory = { nav.navigate("history") },
                onSettings = { nav.navigate("settings") },
            )
        }
        composable("fight") { FightScreen(app, fightId = null, onExit = { nav.popBackStack() }) }
        composable("history") { HistoryScreen(app, onOpen = { nav.navigate("fight/$it") }, onBack = { nav.popBackStack() }) }
        composable("fight/{id}") { entry ->
            FightScreen(app, fightId = entry.arguments?.getString("id"), onExit = { nav.popBackStack() })
        }
        composable("settings") { SettingsScreen(app, onBack = { nav.popBackStack() }) }
    }
}
