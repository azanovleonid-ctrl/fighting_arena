package com.fightingarena.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.arena.ArenaConnection
import com.fightingarena.app.arena.EndMsg
import com.fightingarena.app.arena.Phase
import com.fightingarena.app.arena.StartMsg
import com.fightingarena.app.data.brawler
import com.fightingarena.app.data.modeName

@Composable
fun GameScreen(app: ArenaApp, mode: String, onExit: () -> Unit) {
    val brawler = app.session.profile.value?.settings?.brawler ?: "spark"
    val conn = remember { ArenaConnection(app.session.token.orEmpty(), mode, brawler) }
    DisposableEffect(conn) { onDispose { conn.close() } }
    val phase by conn.phase.collectAsState()
    val profile by app.session.profile.collectAsState()
    BackHandler(onBack = onExit)

    when (val p = phase) {
        Phase.Connecting, Phase.Queued -> Centered {
            CircularProgressIndicator()
            Text("Ищем бой…", style = MaterialTheme.typography.titleMedium)
            OutlinedButton(onClick = onExit) { Text("Отмена") }
        }
        is Phase.Playing -> ArenaView(conn, p.start, vibration = profile?.settings?.vibration != false)
        is Phase.Ended -> ResultsView(p.end, onAgain = conn::playAgain, onExit = onExit)
        is Phase.Failed -> Centered {
            Text(p.message, color = MaterialTheme.colorScheme.error)
            Button(onClick = onExit) { Text("В меню") }
        }
    }
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) { content() }
}

@Composable
private fun ArenaView(conn: ArenaConnection, start: StartMsg, vibration: Boolean) {
    val density = LocalDensity.current
    val controls = remember { TouchControls(with(density) { 64.dp.toPx() }, with(density) { 40.dp.toPx() }) }
    val paints = remember { ArenaPaints() }
    val haptics = LocalHapticFeedback.current
    var frame by remember { mutableLongStateOf(0L) }

    LaunchedEffect(conn) {
        var lastHp = Int.MAX_VALUE
        while (true) {
            withFrameNanos { now ->
                frame = now
                controls.flushMove(conn, now)
                val me = conn.current?.players?.find { it.id == start.you }
                if (me != null) {
                    if (vibration && me.hp < lastHp && lastHp != Int.MAX_VALUE) {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    }
                    lastHp = me.hp
                }
            }
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF1B1F2A))
            .pointerInput(conn) { handleTouches(controls, conn) },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            drawArena(conn, start, controls, paints, frame)
        }
    }
}

@Composable
private fun ResultsView(end: EndMsg, onAgain: () -> Unit, onExit: () -> Unit) {
    val teamMode = end.mode == "ball" || end.mode == "beacon"
    Row(Modifier.fillMaxSize().padding(24.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically)) {
            val place = end.place ?: 0
            val title = when {
                teamMode && end.result == "win" -> "Победа!"
                teamMode && end.result == "draw" -> "Ничья"
                teamMode -> "Поражение"
                place == 1 -> "Победа!"
                else -> "Место $place"
            }
            Text(
                title,
                style = MaterialTheme.typography.displaySmall,
                color = if (end.result == "win") MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurface,
            )
            Text("${modeName(end.mode)} · ${brawler(end.brawler).name}", style = MaterialTheme.typography.titleMedium)
            val mine = (end.team ?: 0).coerceIn(0, 1)
            end.score?.let { Text("Счёт ${it[mine]} : ${it[1 - mine]}", style = MaterialTheme.typography.titleLarge) }
            end.beacon?.let { Text("Маяк ${it[mine]}% : ${it[1 - mine]}%", style = MaterialTheme.typography.titleLarge) }
            Text("Опыт +${end.xpGained}", style = MaterialTheme.typography.titleLarge)
            Button(onClick = onAgain, modifier = Modifier.widthIn(max = 320.dp).fillMaxWidth()) { Text("Ещё бой") }
            OutlinedButton(onClick = onExit, modifier = Modifier.widthIn(max = 320.dp).fillMaxWidth()) { Text("В меню") }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Text("#", Modifier.weight(0.6f), fontWeight = FontWeight.Bold)
                Text("Игрок", Modifier.weight(3f), fontWeight = FontWeight.Bold)
                if (end.mode == "ball") Text("Голы", Modifier.weight(1.2f), fontWeight = FontWeight.Bold)
                if (!teamMode) Text("Кубы", Modifier.weight(1.2f), fontWeight = FontWeight.Bold)
                Text("Побед.", Modifier.weight(1.4f), fontWeight = FontWeight.Bold)
            }
            end.results.forEach { r ->
                val color = when {
                    r.you -> MaterialTheme.colorScheme.primary
                    end.mode != "survival" && r.team == end.team -> Color(0xFF4FC3F7)
                    else -> MaterialTheme.colorScheme.onSurface
                }
                Row(Modifier.fillMaxWidth()) {
                    Text(if (r.place > 0) "${r.place}" else "—", Modifier.weight(0.6f), color = color)
                    Text(
                        "${r.name} · ${brawler(r.brawler).name}",
                        Modifier.weight(3f),
                        color = color,
                        fontWeight = if (r.you) FontWeight.Bold else null,
                    )
                    if (end.mode == "ball") Text("${r.goals}", Modifier.weight(1.2f), color = color)
                    if (!teamMode) Text("${r.cubes}", Modifier.weight(1.2f), color = color)
                    Text("${r.kills}", Modifier.weight(1.4f), color = color)
                }
            }
        }
    }
}
