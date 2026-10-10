package com.fightingarena.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.drawscope.scale
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

    // Portrait, everything on one screen without scrolling.
    Column(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(profile?.username ?: "Арена бойцов", style = MaterialTheme.typography.titleLarge)
                profile?.let { p ->
                    Text(
                        "Победы ${p.record.wins} · поражения ${p.record.losses} · ничьи ${p.record.draws}",
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        }
        UpdateBanner(app)
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
        BRAWLERS.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { b ->
                    BrawlerCard(b, selected = b.id == chosen.id, Modifier.weight(1f)) { choose { it.copy(brawler = b.id) } }
                }
            }
        }
        BrawlerDetails(chosen)
        MODES.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.height(IntrinsicSize.Min)) {
                row.forEach { m ->
                    ModeCard(m, selected = m.id == settings.mode, Modifier.weight(1f).fillMaxHeight()) { choose { it.copy(mode = m.id) } }
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Button(onClick = { onFight(settings.mode) }, modifier = Modifier.fillMaxWidth().height(56.dp)) {
            Text("В бой", style = MaterialTheme.typography.titleLarge)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(onClick = onHistory, modifier = Modifier.weight(1f)) { Text("История") }
            OutlinedButton(onClick = onSettings, modifier = Modifier.weight(1f)) { Text("Настройки") }
            TextButton(onClick = { scope.launch { app.session.signOut() } }) { Text("Выйти") }
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
        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp, horizontal = 2.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Canvas(Modifier.size(28.dp)) {
                if (b.id == "hammer") {
                    // The bear, standing still, scaled to fit the card.
                    val k = size.minDimension / 100f
                    scale(k, k, pivot = center) { drawBear(center + Offset(0f, 22f), WalkState(0f, 0f), b.color, 1f, 0f) }
                } else {
                    drawCircle(b.color)
                    drawCircle(androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.5f), style = androidx.compose.ui.graphics.drawscope.Stroke(3f))
                }
            }
            Text(b.name, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            Text(b.role, style = MaterialTheme.typography.labelSmall, textAlign = TextAlign.Center, maxLines = 1)
        }
    }
}

@Composable
private fun BrawlerDetails(b: BrawlerInfo) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            Text("${b.name} · ${b.role}", style = MaterialTheme.typography.titleMedium)
            Text("Здоровье ${b.hp} · скорость ${b.speed} · дальность ${b.range} · урон ${b.damage}", style = MaterialTheme.typography.bodySmall)
            Text("Атака: ${b.attack}", style = MaterialTheme.typography.bodySmall)
            Text("Супер: ${b.superName}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun ModeCard(m: ModeInfo, selected: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = modifier,
        border = if (selected) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        colors = CardDefaults.cardColors(
            containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
        ),
    ) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 6.dp)) {
            Text(m.name, fontWeight = FontWeight.Bold)
            Text(m.about, style = MaterialTheme.typography.labelSmall)
        }
    }
}
