package com.fightingarena.app.ui

import android.app.Activity
import android.content.pm.ActivityInfo
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
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
import kotlinx.coroutines.delay
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.arena.ArenaConnection
import com.fightingarena.app.arena.EndMsg
import com.fightingarena.app.arena.PartyRequest
import com.fightingarena.app.arena.Phase
import com.fightingarena.app.arena.StartMsg
import com.fightingarena.app.data.brawler
import com.fightingarena.app.data.modeName

@Composable
fun GameScreen(app: ArenaApp, mode: String, party: PartyRequest? = null, onExit: () -> Unit) {
    val brawler = app.session.profile.value?.settings?.brawler ?: "spark"
    val conn = remember { ArenaConnection(app.session.token.orEmpty(), mode, brawler, party) }
    DisposableEffect(conn) { onDispose { conn.close() } }
    val phase by conn.phase.collectAsState()
    val profile by app.session.profile.collectAsState()
    BackHandler(onBack = onExit)

    when (val p = phase) {
        Phase.Connecting, Phase.Queued -> Centered {
            // A friend's room answers at once; a server without rooms never answers.
            var slow by remember { mutableStateOf(false) }
            LaunchedEffect(Unit) {
                delay(6_000)
                slow = true
            }
            CircularProgressIndicator()
            Text(
                when (party) {
                    is PartyRequest.Create -> "Создаём комнату…"
                    is PartyRequest.Join -> "Входим в комнату…"
                    null -> "Ищем бой…"
                },
                style = MaterialTheme.typography.titleMedium,
            )
            if (party != null && slow) {
                Text(
                    "Сервер не отвечает на игру с другом. Скорее всего, его нужно обновить командой с компьютера.",
                    color = MaterialTheme.colorScheme.error,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 24.dp),
                )
            }
            OutlinedButton(onClick = onExit) { Text("Отмена") }
        }
        is Phase.Party -> Centered {
            Text("Комната для друга", style = MaterialTheme.typography.titleMedium)
            Text(p.code, style = MaterialTheme.typography.displayLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.secondary)
            Text(
                "Скажите другу этот код. Он нажимает «С другом», вводит код и жмёт «Войти».",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 24.dp),
            )
            Text(
                "${modeName(mode)} · " + if (p.together) "вы в одной команде" else "вы друг против друга",
                style = MaterialTheme.typography.bodyMedium,
            )
            CircularProgressIndicator()
            OutlinedButton(onClick = onExit) { Text("Отмена") }
        }
        is Phase.Playing -> ArenaView(conn, p.start, vibration = profile?.settings?.vibration != false)
        // A friend's room is single-use: "again" is offered only for normal matchmaking.
        is Phase.Ended -> ResultsView(p.end, onAgain = if (party == null) conn::playAgain else null, onExit = onExit)
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
    val predictor = remember(start) { Predictor(start.map) }
    val local = remember(start) { LocalShots(start) }
    controls.onRelease = { aim -> local.kickIfHolding(aim, conn, conn.latest) }
    controls.trigger = { aim -> local.tryFire(aim, conn, conn.latest, predictor.pos ?: conn.latest?.players?.find { it.id == start.you }?.let { Offset(it.x, it.y) }, System.nanoTime()) }
    val speed = brawler(start.brawler).speed.toFloat()
    val activity = LocalContext.current as? Activity
    DisposableEffect(Unit) {
        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        onDispose { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT }
    }
    val haptics = LocalHapticFeedback.current
    var frame by remember { mutableLongStateOf(0L) }
    val fps = remember { FloatArray(1) }

    LaunchedEffect(conn) {
        var lastHp = Int.MAX_VALUE
        while (true) {
            withFrameNanos { now ->
                if (frame != 0L && now > frame) fps[0] = fps[0] * 0.95f + 0.05f * (1e9f / (now - frame))
                frame = now
                conn.maybePing(now)
                if (!predictor.numbered) controls.flushMove(conn, now)
                predictor.update(now, conn.latest, start.you, controls.moveVector(), speed, conn)
                local.step(now, conn.latest, predictor.pos)
                controls.holdFire()
                val me = conn.latest?.players?.find { it.id == start.you }
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
            drawArena(conn, start, controls, paints, predictor.pos, local, "${fps[0].toInt()} к/с · пинг ${conn.pingMs?.let { "$it мс (лучший ${conn.pingMinMs})" } ?: "—"}", frame)
        }
    }
}

@Composable
private fun ResultsView(end: EndMsg, onAgain: (() -> Unit)?, onExit: () -> Unit) {
    val teamMode = end.mode == "ball" || end.mode == "beacon"
    // Portrait, fits on one screen: at most 6 rows in the table.
    Column(
        Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val place = end.place ?: 0
        val title = when {
            teamMode && end.result == "win" -> "Победа!"
            teamMode && end.result == "draw" -> "Ничья"
            teamMode -> "Поражение"
            place == 1 -> "Победа!"
            else -> "Место $place"
        }
        Spacer(Modifier.weight(0.5f))
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
        Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(Modifier.fillMaxWidth()) {
                Text("#", Modifier.weight(0.6f), fontWeight = FontWeight.Bold)
                Text("Игрок", Modifier.weight(3f), fontWeight = FontWeight.Bold)
                if (end.mode == "ball") Text("Голы", Modifier.weight(1.2f), fontWeight = FontWeight.Bold)
                if (!teamMode) Text("Кубы", Modifier.weight(1.2f), fontWeight = FontWeight.Bold)
                Text("Побед.", Modifier.weight(1.4f), fontWeight = FontWeight.Bold)
            }
            end.results.take(6).forEach { r ->
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
                        maxLines = 1,
                    )
                    if (end.mode == "ball") Text("${r.goals}", Modifier.weight(1.2f), color = color)
                    if (!teamMode) Text("${r.cubes}", Modifier.weight(1.2f), color = color)
                    Text("${r.kills}", Modifier.weight(1.4f), color = color)
                }
            }
        }
        Spacer(Modifier.weight(1f))
        onAgain?.let { Button(onClick = it, modifier = Modifier.fillMaxWidth().height(56.dp)) { Text("Ещё бой", style = MaterialTheme.typography.titleLarge) } }
        OutlinedButton(onClick = onExit, modifier = Modifier.fillMaxWidth()) { Text("В меню") }
    }
}
