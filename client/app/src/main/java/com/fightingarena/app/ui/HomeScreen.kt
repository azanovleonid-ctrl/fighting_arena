package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.StatPoints
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(app: ArenaApp, onFight: () -> Unit, onHistory: () -> Unit, onSettings: () -> Unit) {
    val profile by app.session.profile.collectAsState()
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    // Refresh on every visit so XP and record are current after a fight.
    LaunchedEffect(Unit) {
        val r = app.call { app.api.me() }
        r.onSuccess { app.session.profile.value = it }
        error = r.errorText()
    }

    fun spend(points: StatPoints) = scope.launch {
        val r = app.call { app.api.spendPoints(points) }
        r.onSuccess { app.session.profile.value = it }
        error = r.errorText()
    }

    Scaffold(topBar = { ArenaTopBar("Арена бойцов") }) { padding ->
        // Landscape: character on the left, menu on the right.
        Row(
            Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                profile?.let { p ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(p.username, style = MaterialTheme.typography.headlineSmall)
                            Text("Уровень ${p.level} · здоровье ${p.maxHp}")
                            LinearProgressIndicator(
                                progress = { p.xp.toFloat() / p.xpToNextLevel },
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text("Опыт ${p.xp}/${p.xpToNextLevel}", style = MaterialTheme.typography.bodySmall)
                            Text("Победы ${p.record.wins} · поражения ${p.record.losses} · ничьи ${p.record.draws}")
                        }
                    }
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text("Характеристики", style = MaterialTheme.typography.titleMedium)
                            if (p.freePoints > 0) Text("Свободных очков: ${p.freePoints}", color = MaterialTheme.colorScheme.secondary)
                            StatRow("Сила", p.stats.strength, p.freePoints > 0) { spend(StatPoints(strength = 1)) }
                            StatRow("Ловкость", p.stats.agility, p.freePoints > 0) { spend(StatPoints(agility = 1)) }
                            StatRow("Интуиция", p.stats.intuition, p.freePoints > 0) { spend(StatPoints(intuition = 1)) }
                            StatRow("Выносливость", p.stats.endurance, p.freePoints > 0) { spend(StatPoints(endurance = 1)) }
                        }
                    }
                }
            }
            Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Button(onClick = onFight, modifier = Modifier.fillMaxWidth()) { Text("В бой!") }
                OutlinedButton(onClick = onHistory, modifier = Modifier.fillMaxWidth()) { Text("История боёв") }
                OutlinedButton(onClick = onSettings, modifier = Modifier.fillMaxWidth()) { Text("Настройки") }
                TextButton(onClick = { scope.launch { app.session.signOut() } }) { Text("Выйти из аккаунта") }
            }
        }
    }
}

@Composable
private fun StatRow(name: String, value: Int, canAdd: Boolean, onAdd: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(name, Modifier.weight(1f))
        Text("$value", style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.padding(4.dp))
        if (canAdd) TextButton(onClick = onAdd) { Text("+1") }
    }
}
