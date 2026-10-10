package com.fightingarena.app.ui

import androidx.compose.ui.geometry.Offset
import com.fightingarena.app.arena.MapInfo
import com.fightingarena.app.arena.StartMsg
import com.fightingarena.app.arena.StateMsg
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

private const val COOLDOWN_NANOS = 320_000_000L
private const val ARROW_GAP_NANOS = 90_000_000L
private const val BOMB_NANOS = 550_000_000L

/** A shot the phone draws itself the moment you fire; the server still decides what it hits. */
class LocalShot(
    var x: Float,
    var y: Float,
    val vx: Float,
    val vy: Float,
    var rangeLeft: Float,
    val bornNanos: Long,
)

class LocalBomb(val from: Offset, val to: Offset, val bornNanos: Long)

class LocalSlash(val at: Offset, val angle: Float, val bornNanos: Long)

/** Pattern of the main attack, matching server/src/arena/sim.ts. */
private class Pattern(val angles: List<Float>, val speed: Float, val range: Float, val burst: Int = 1)

private fun patternOf(brawler: String): Pattern? = when (brawler) {
    "spark" -> Pattern((-2..2).map { it * 0.11f }, 920f, 330f)
    "tinker" -> Pattern(listOf(-0.05f, 0.05f), 950f, 520f)
    "shade" -> Pattern(listOf(-0.08f, 0.08f), 1150f, 210f)
    "blizzard" -> Pattern(listOf(0f), 850f, 560f)
    "arrow" -> Pattern(listOf(0f), 1050f, 620f, burst = 3)
    else -> null
}

/**
 * Shows your own attack instantly instead of after a round trip to the server. Only the looks are
 * predicted: damage, hits and ammo stay on the server.
 */
class LocalShots(private val start: StartMsg) {
    private val map: MapInfo = start.map
    val shots = mutableListOf<LocalShot>()
    val bombs = mutableListOf<LocalBomb>()
    val slashes = mutableListOf<LocalSlash>()
    private val pending = mutableListOf<Pair<Long, Float>>() // Стрела's burst: when, angle
    private var lastFireNanos = 0L
    private var lastStepNanos = 0L

    /** Same aim rules as the server: a zero vector aims at the nearest visible enemy. */
    fun fire(aim: Offset, latest: StateMsg?, from: Offset?, nowNanos: Long) {
        val state = latest ?: return
        val pos = from ?: return
        val me = state.players.find { it.id == start.you } ?: return
        val ammo = state.me?.ammo ?: 0f
        if (!me.alive || ammo < 1f || nowNanos - lastFireNanos < COOLDOWN_NANOS || state.pause > 0) return
        if (state.ball?.h == start.you) return // that is a kick, the server draws the ball
        val range = com.fightingarena.app.data.brawler(start.brawler).range.toFloat()
        val target = state.players
            .filter { it.alive && it.id != start.you && (start.mode == "survival" || it.tm != me.tm) }
            .minByOrNull { (Offset(it.x, it.y) - pos).getDistance() }
            ?.takeIf { (Offset(it.x, it.y) - pos).getDistance() < range + 80f }
        val len = aim.getDistance()
        val angle = when {
            len > 0.01f -> atan2(aim.y, aim.x)
            target != null -> atan2(target.y - pos.y, target.x - pos.x)
            else -> me.f
        }
        lastFireNanos = nowNanos
        when (start.brawler) {
            "hammer" -> slashes += LocalSlash(pos, angle, nowNanos)
            "thunder" -> {
                val dist = when {
                    len > 0.01f -> len.coerceAtMost(1f) * range
                    target != null -> (Offset(target.x, target.y) - pos).getDistance().coerceAtMost(range)
                    else -> range * 0.7f
                }.coerceAtLeast(70f)
                bombs += LocalBomb(pos, pos + Offset(cos(angle), sin(angle)) * dist, nowNanos)
            }
            else -> {
                val p = patternOf(start.brawler) ?: return
                spawn(p, pos, angle, nowNanos)
                for (i in 1 until p.burst) pending += (nowNanos + i * ARROW_GAP_NANOS) to angle
            }
        }
    }

    private fun spawn(p: Pattern, pos: Offset, angle: Float, nowNanos: Long) {
        for (a in p.angles) {
            shots += LocalShot(pos.x, pos.y, cos(angle + a) * p.speed, sin(angle + a) * p.speed, p.range, nowNanos)
        }
    }

    /** Advances shots; they stop at walls, boxes, enemies and the end of their range. */
    fun step(nowNanos: Long, latest: StateMsg?, from: Offset?) {
        val dt = if (lastStepNanos == 0L) 0f else ((nowNanos - lastStepNanos) / 1e9f).coerceAtMost(0.05f)
        lastStepNanos = nowNanos
        val due = pending.filter { it.first <= nowNanos }
        if (due.isNotEmpty() && from != null) {
            patternOf(start.brawler)?.let { p -> due.forEach { (_, a) -> spawn(p, from, a, nowNanos) } }
        }
        pending.removeAll(due)
        val boxes = latest?.boxes?.mapTo(HashSet()) { it[0] }
        val me = latest?.players?.find { it.id == start.you }
        val enemies = latest?.players.orEmpty()
            .filter { it.alive && it.id != start.you && (start.mode == "survival" || it.tm != me?.tm) }
        val radius = map.playerRadius + 8f
        shots.removeAll { s ->
            s.x += s.vx * dt
            s.y += s.vy * dt
            s.rangeLeft -= hypotOf(s.vx, s.vy) * dt
            s.rangeLeft <= 0f || solid(s.x, s.y, boxes) ||
                enemies.any { (Offset(it.x, it.y) - Offset(s.x, s.y)).getDistance() < radius }
        }
        bombs.removeAll { nowNanos - it.bornNanos > BOMB_NANOS }
        slashes.removeAll { nowNanos - it.bornNanos > 300_000_000L }
    }

    /** True for a server shot this class already draws (your own ordinary bullet or bomb). */
    fun covers(kind: String, owner: Int, isSuper: Boolean, at: Offset): Boolean {
        if (owner != start.you || isSuper) return false
        return when (kind) {
            "bomb" -> bombs.isNotEmpty()
            // Turret bullets have the same owner, so only hide bullets next to a local one.
            "bullet" -> shots.any { (Offset(it.x, it.y) - at).getDistance() < 90f }
            else -> false
        }
    }

    private fun solid(x: Float, y: Float, boxes: Set<Int>?): Boolean {
        val c = floor(x / map.tile).toInt()
        val r = floor(y / map.tile).toInt()
        val ch = map.tileAt(c, r)
        return ch == '#' || (ch == 'x' && boxes?.contains(r * map.cols + c) == true)
    }

    private fun hypotOf(x: Float, y: Float) = kotlin.math.hypot(x, y)
}
