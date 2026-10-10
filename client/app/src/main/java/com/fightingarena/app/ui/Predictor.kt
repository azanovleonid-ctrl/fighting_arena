package com.fightingarena.app.ui

import androidx.compose.ui.geometry.Offset
import com.fightingarena.app.arena.MapInfo
import com.fightingarena.app.arena.StateMsg
import kotlin.math.floor
import kotlin.math.hypot

private const val SLOW = 0.55f
private const val INVISIBLE = 1.3f
private const val CARRIER = 0.85f
/** Roughly how long a move takes to come back from the server. */
private const val LEAD_S = 0.12f
private const val PULL = 0.1f
private const val SNAP_DISTANCE = 120f

/**
 * Moves your own brawler on the phone right away instead of waiting for the server, using the
 * same speed and walls, and keeps it pulled toward where the server says it is.
 */
class Predictor(private val map: MapInfo) {
    var pos: Offset? = null
        private set
    private var lastNanos = 0L

    fun update(nowNanos: Long, latest: StateMsg?, you: Int, move: Offset, baseSpeed: Float) {
        val dt = if (lastNanos == 0L) 0f else ((nowNanos - lastNanos) / 1e9f).coerceAtMost(0.05f)
        lastNanos = nowNanos
        if (latest == null) {
            pos = null
            return
        }
        val me = latest.players.find { it.id == you }
        val server = me?.let { Offset(it.x, it.y) }
        // Jumps, pauses and knock-outs are the server's alone.
        if (me == null || server == null || !me.alive || me.air != null || latest.pause > 0) {
            pos = server
            return
        }
        var speed = baseSpeed
        if (me.sl) speed *= SLOW
        if (me.inv) speed *= INVISIBLE
        if (latest.ball?.h == you) speed *= CARRIER
        val boxes = latest.boxes?.mapTo(HashSet()) { it[0] }
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
