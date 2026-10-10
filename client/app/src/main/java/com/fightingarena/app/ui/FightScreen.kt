package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.Fight
import com.fightingarena.app.data.Move
import com.fightingarena.app.data.Round
import com.fightingarena.app.data.Strike
import com.fightingarena.app.data.Zone
import com.fightingarena.app.data.resultTitle
import kotlinx.coroutines.launch

/** With [fightId] == null starts (or resumes) a fight; otherwise shows that fight from history. */
@Composable
fun FightScreen(app: ArenaApp, fightId: String?, onExit: () -> Unit) {
    var fight by remember { mutableStateOf<Fight?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var attack by remember { mutableStateOf<Zone?>(null) }
    var blocks by remember { mutableStateOf(listOf<Zone>()) }
    val profile by app.session.profile.collectAsState()
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(fightId) {
        val r = app.call { if (fightId == null) app.api.startFight() else app.api.fight(fightId) }
        r.onSuccess { fight = it }
        error = r.errorText()
    }

    fun submit(f: Fight, move: Move) {
        busy = true
        scope.launch {
            val r = app.call { app.api.turn(f.id, move) }
            r.onSuccess { updated ->
                val tookDamage = updated.player.hp < f.player.hp
                if (tookDamage && profile?.settings?.vibration != false) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                }
                fight = updated
                attack = null
                blocks = emptyList()
            }
            error = r.errorText()
            busy = false
        }
    }

    Scaffold(topBar = { ArenaTopBar(fight?.let { "Бой с ${it.opponent.name}" } ?: "Бой", onBack = onExit) }) { padding ->
        val f = fight
        if (f == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (error != null) Text(error!!, color = MaterialTheme.colorScheme.error) else CircularProgressIndicator()
            }
            return@Scaffold
        }
        Row(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            Column(
                Modifier.weight(1f).fillMaxHeight().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    HpBar(f.player.name, f.player.hp, f.player.maxHp, Modifier.weight(1f))
                    HpBar(f.opponent.name, f.opponent.hp, f.opponent.maxHp, Modifier.weight(1f))
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

                if (f.isActive) {
                    Text("Удар", style = MaterialTheme.typography.titleSmall)
                    ZoneChips(selected = listOfNotNull(attack)) { attack = it }
                    Text("Блок", style = MaterialTheme.typography.titleSmall)
                    ZoneChips(selected = blocks) { z ->
                        blocks = when {
                            z in blocks -> blocks - z
                            blocks.size < 2 -> blocks + z
                            else -> listOf(blocks[1], z)
                        }
                    }
                    Button(
                        onClick = { submit(f, Move(attack!!, blocks)) },
                        enabled = !busy && attack != null && blocks.size == 2,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Ход") }
                } else {
                    Text(
                        "${resultTitle(f.result)}! Опыт +${f.xpGained}",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    Button(onClick = onExit, modifier = Modifier.fillMaxWidth()) { Text("Готово") }
                }
            }
            Box(Modifier.weight(1f).fillMaxHeight()) { RoundLog(f) }
        }
    }
}

@Composable
private fun ZoneChips(selected: List<Zone>, onToggle: (Zone) -> Unit) {
    // Two rows so five chips fit on a phone screen.
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        listOf(Zone.entries.take(3), Zone.entries.drop(3)).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { z -> FilterChip(selected = z in selected, onClick = { onToggle(z) }, label = { Text(z.title) }) }
            }
        }
    }
}

@Composable
private fun RoundLog(f: Fight) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(f.rounds.reversed(), key = { it.number }) { round -> RoundItem(round, f) }
    }
}

@Composable
private fun RoundItem(round: Round, f: Fight) {
    Column {
        Text("Раунд ${round.number}", fontWeight = FontWeight.Bold)
        round.strikes.forEach { s ->
            val who = if (s.attacker == "player") f.player.name else f.opponent.name
            Text("$who → ${s.zone.title.lowercase()}: ${describe(s)}", style = MaterialTheme.typography.bodyMedium)
        }
    }
}

private fun describe(s: Strike) = when (s.outcome) {
    "hit" -> "попал, −${s.damage}"
    "crit" -> "крит! −${s.damage}"
    "blocked" -> "блок"
    "crit_through_block" -> "пробил блок, −${s.damage}"
    "dodged" -> "уворот"
    else -> s.outcome
}
