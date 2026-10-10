package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.Settings
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(app: ArenaApp, onBack: () -> Unit) {
    val profile by app.session.profile.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val settings = profile?.settings ?: Settings()

    // Applies the change locally at once, then saves it on the server.
    fun update(new: Settings) {
        val before = profile ?: return
        app.session.profile.value = before.copy(settings = new)
        scope.launch {
            val r = app.call { app.api.updateSettings(new) }
            r.onFailure { app.session.profile.value = before }
            error = r.errorText()
        }
    }

    Scaffold(topBar = { ArenaTopBar("Настройки", onBack = onBack) }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Choice("Тема", listOf("dark" to "Тёмная", "light" to "Светлая"), settings.theme) { update(settings.copy(theme = it)) }
            Choice("Язык", listOf("ru" to "Русский", "en" to "English"), settings.language) { update(settings.copy(language = it)) }
            Toggle("Звук", settings.sound) { update(settings.copy(sound = it)) }
            Toggle("Вибрация при ударе", settings.vibration) { update(settings.copy(vibration = it)) }
        }
    }
}

@Composable
private fun Choice(title: String, options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (key, label) -> FilterChip(selected = value == key, onClick = { onChange(key) }, label = { Text(label) }) }
        }
    }
}

@Composable
private fun Toggle(title: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f))
        Switch(checked = value, onCheckedChange = onChange)
    }
}
