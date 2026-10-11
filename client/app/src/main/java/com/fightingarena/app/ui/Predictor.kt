package com.fightingarena.app.ui

import androidx.compose.ui.geometry.Offset
import com.fightingarena.app.arena.ArenaConnection
import com.fightingarena.app.arena.MapInfo
import com.fightingarena.app.arena.StateMsg
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot

private const val SLOW = 0.55f
private const val INVISIBLE = 1.3f
private const val CARRIER = 0.85f
/** Server tick: one numbered move walks exactly this long there and here. */
private const val TICK_S = 0.033f
/** Differences smaller than this (positions arrive rounded) are left alone. */
private const val DEAD_ZONE = 1.5f
private const val SNAP_DISTANCE = 120f
/** How fast a correction from the server fades in, in seconds. */
private const val SMOOTH_S = 0.08f
// Older servers without numbered moves: aim a little ahead of the server's position.
private const val LEAD_S = 0.12f
private const val PULL = 0.1f

/**
 * Moves your own brawler on the phone right away instead of waiting for the server.
 *
 * Walking is cut into ticks like on the server: each tick the phone sends a numbered move and walks
 * by the same step itself. The server tells which number it applied last, so the phone starts from
 * the server's position and replays only the moves still on their way. When both agree nothing moves
 * on screen; real differences (a push, a knockback) fade in smoothly.
 */
class Predictor(private val map: MapInfo) {
    var pos: Offset? = null
        private set
    /** True once the server confirms numbered moves; walking messages then come from here. */
    var numbered = false
        private set
    private var lastNanos = 0L
    private var tickPos: Offset? = null
    private var correction = Offset.Zero
    private var acc = 0f
    private var seq = 0
    private var sentStop = true
    private var lastMove = Offset.Zero
    private val pending = ArrayDeque<Pair<Int, Offset>>()
    private var seen: StateMsg? = null

    fun update(nowNanos: Long, latest: StateMsg?, you: Int, move: Offset, baseSpeed: Float, conn: ArenaConnection) {
        val dt = if (lastNanos == 0L) 0f else ((nowNanos - lastNanos) / 1e9f).coerceAtMost(0.1f)
        lastNanos = nowNanos
        val me = latest?.players?.find { it.id == you }
        val server = me?.let { Offset(it.x, it.y) }
        numbered = latest?.me?.ack != null
        // Jumps, pauses and knock-outs are the server's alone.
        if (latest == null || me == null || server == null || !me.alive || me.air != null || latest.pause > 0) {
            reset(server)
            return
        }
        var speed = baseSpeed
        if (me.sl) speed *= SLOW
        if (me.inv) speed *= INVISIBLE
        if (latest.ball?.h == you) speed *= CARRIER
        val boxes = latest.boxes?.mapTo(HashSet()) { it[0] }
        if (!numbered) {
            legacy(dt, server, move, speed, boxes)
            return
        }

        // A new snapshot: start from the server and replay the moves it hasn't applied yet.
        if (latest !== seen) {
            seen = latest
            val ack = latest.me?.ack ?: -1
            while (pending.isNotEmpty() && pending.first().first <= ack) pending.removeFirst()
            var p: Offset = server
            for ((_, v) in pending) p = resolve(p + v * (speed * TICK_S), boxes)
            val old = tickPos
            if (old == null || (p - old).getDistance() > SNAP_DISTANCE) {
                tickPos = p
                correction = Offset.Zero
            } else if ((p - old).getDistance() > DEAD_ZONE) {
                val shift = p - old
                tickPos = p
                correction -= shift
            }
        }

        acc += dt
        while (acc >= TICK_S) {
            acc -= TICK_S
            val stop = move == Offset.Zero
            if (stop && sentStop) continue
            sentStop = stop
            seq += 1
            conn.move(move.x, move.y, seq)
            pending.addLast(seq to move)
            while (pending.size > 60) pending.removeFirst()
            tickPos = resolve((tickPos ?: server) + move * (speed * TICK_S), boxes)
        }
        correction *= exp(-dt / SMOOTH_S)
        // Between ticks the brawler keeps walking with the stick as it is now, so it reacts at once.
        val b: Offset = tickPos ?: server
        val raw = resolve(b + move * (speed * acc), boxes)
        // Turning or letting go mid-tick must not jump: the difference fades like a correction.
        if (move != lastMove) correction += resolve(b + lastMove * (speed * acc), boxes) - raw
        lastMove = move
        pos = raw + correction
    }

    private fun reset(server: Offset?) {
        pos = server
        tickPos = server
        correction = Offset.Zero
        pending.clear()
        acc = 0f
        sentStop = true
        lastMove = Offset.Zero
    }

    private fun legacy(dt: Float, server: Offset, move: Offset, speed: Float, boxes: Set<Int>?) {
        val step = speed * dt
        val next = resolve((pos ?: server) + Offset(move.x * step, move.y * step), boxes)
        val target = resolve(server + Offset(move.x * speed * LEAD_S, move.y * speed * LEAD_S), boxes)
        val error = target - next
        pos = if (error.getDistance() > SNAP_DISTANCE) target else next + error * PULL
    }

    private fun solid(c: Int, r: Int, boxes: Set<Int>?): Boolean {
        val ch = map.tileAt(c, r)
        return ch == '#' || (ch == 'x' && boxes?.contains(r * map.cols + c) == true)
    }

    /** Pushes the brawler's circle out of walls and boxes, like the server does. */
    private fun resolve(p: Offset, boxes: Set<Int>?): Offset {
        val tile = map.tile.toFloat()
        val radius = map.playerRadius.toFloat()
        var px = p.x
        var py = p.y
        val c0 = floor((px - radius) / tile).toInt()
        val c1 = floor((px + radius) / tile).toInt()
        val r0 = floor((py - radius) / tile).toInt()
        val r1 = floor((py + radius) / tile).toInt()
        for (r in r0..r1) for (c in c0..c1) {
            if (!solid(c, r, boxes)) continue
            val left = c * tile
            val top = r * tile
            val nx = px.coerceIn(left, left + tile)
            val ny = py.coerceIn(top, top + tile)
            val dx = px - nx
            val dy = py - ny
            val d = hypot(dx, dy)
            if (d >= radius) continue
            if (d > 0f) {
                px = nx + dx / d * radius
                py = ny + dy / d * radius
            } else {
                val outs = listOf(
                    Triple(px - left, left - radius, py),
                    Triple(left + tile - px, left + tile + radius, py),
                    Triple(py - top, px, top - radius),
                    Triple(top + tile - py, px, top + tile + radius),
                ).minBy { it.first }
                px = outs.second
                py = outs.third
            }
        }
        return Offset(px, py)
    }
}
