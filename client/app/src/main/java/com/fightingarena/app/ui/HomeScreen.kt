package com.fightingarena.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.BRAWLERS
import com.fightingarena.app.data.BrawlerInfo
import com.fightingarena.app.data.MODES
import com.fightingarena.app.data.ModeInfo
import com.fightingarena.app.data.Settings
import com.fightingarena.app.data.brawler
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(app: ArenaApp, onFight: (mode: String) -> Unit, onHistory: () -> Unit, onSettings: () -> Unit) {
    val profile by app.session.profile.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Refresh on every visit so the record is current after a fight.
    LaunchedEffect(Unit) {
        val r = app.call { app.api.me() }
        r.onSuccess { app.session.profile.value = it }
        error = r.errorText()
    }
    LaunchedEffect(Unit) { app.updater.checkForUpdate() }

    // The chosen brawler and mode are saved in the account, so the phone remembers them.
    fun choose(change: (Settings) -> Settings) {
        val p = profile ?: return
        val settings = change(p.settings)
        app.session.profile.value = p.copy(settings = settings)
        scope.launch {
            val r = app.call { app.api.updateSettings(settings) }
            r.onFailure { app.session.profile.value = p }
            error = r.errorText()
        }
    }

    val settings = profile?.settings ?: Settings()
    val chosen = brawler(settings.brawler)

    Scaffold(topBar = { ArenaTopBar("Арена бойцов") }) { padding ->
        // Landscape: brawlers on the left, mode and menu on the right.
        Row(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Column(
                Modifier.weight(1.5f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                BRAWLERS.chunked(4).forEach { row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        row.forEach { b ->
                            BrawlerCard(b, selected = b.id == chosen.id, Modifier.weight(1f)) { choose { it.copy(brawler = b.id) } }
                        }
                    }
                }
                BrawlerDetails(chosen)
            }
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                UpdateBanner(app)
                profile?.let { p ->
                    Text(p.username, style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Победы ${p.record.wins} · поражения ${p.record.losses} · ничьи ${p.record.draws}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                MODES.forEach { m -> ModeCard(m, selected = m.id == settings.mode) { choose { it.copy(mode = m.id) } } }
                Button(onClick = { onFight(settings.mode) }, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text("В бой", style = MaterialTheme.typography.titleMedium)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = onHistory, modifier = Modifier.weight(1f)) { Text("История") }
                    OutlinedButton(onClick = onSettings, modifier = Modifier.weight(1f)) { Text("Настройки") }
                }
                TextButton(onClick = { scope.launch { app.session.signOut() } }) { Text("Выйти из аккаунта") }
            }
        }
    }
}

@Composable
private fun BrawlerCard(b: BrawlerInfo, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = modifier,
        border = if (selected) BorderStroke(3.dp, MaterialTheme.colorScheme.secondary) else null,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.fillMaxWidth().padding(8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(Modifier.size(36.dp)) {
                drawCircle(b.color)
                drawCircle(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.5f), style = androidx.compose.ui.graphics.drawscope.Stroke(3f))
            }
            Text(b.name, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(b.role, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun BrawlerDetails(b: BrawlerInfo) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text("${b.name} · ${b.role}", style = MaterialTheme.typography.titleMedium)
            Text("Здоровье ${b.hp} · скорость ${b.speed} · дальность ${b.range} · урон ${b.damage}", style = MaterialTheme.typography.bodySmall)
            Text("Атака: ${b.attack}", style = MaterialTheme.typography.bodySmall)
            Text("Супер: ${b.superName}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ModeCard(m: ModeInfo, selected: Boolean, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(m.name, fontWeight = FontWeight.Bold)
            Text(m.about, style = MaterialTheme.typography.bodySmall)
        }
    }
}
