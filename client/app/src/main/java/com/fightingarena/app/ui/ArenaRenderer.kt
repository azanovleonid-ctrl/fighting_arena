package com.fightingarena.app.ui

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.IntSize
import com.fightingarena.app.arena.ArenaConnection
import com.fightingarena.app.arena.PlayerSnap
import com.fightingarena.app.arena.StartMsg
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

private const val VIEW_HEIGHT = 720f // world units visible vertically
private const val TICK_NANOS = 33_000_000f
private const val BULLET_RANGE = 640f
private const val SHOTGUN_RANGE = 420f
private const val SHOTGUN_SPREAD = 0.5f
private const val KICK_RANGE = 700f
private val TEAM_COLORS = listOf(Color(0xFF42A5F5), Color(0xFFEF5350))

private val PLAYER_COLORS = listOf(
    Color(0xFF4FC3F7), Color(0xFFFF7043), Color(0xFFAB47BC),
    Color(0xFFFFCA28), Color(0xFF66BB6A), Color(0xFFEC407A),
)
private val FLOOR_A = Color(0xFFD9B98A)
private val FLOOR_B = Color(0xFFD2B080)
private val WALL = Color(0xFF7A4E2D)
private val WALL_TOP = Color(0xFF9C6A40)
private val BUSH = Color(0xFF2E7D32)

class ArenaPaints {
    val name = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 20f
        typeface = Typeface.DEFAULT_BOLD
        setShadowLayer(3f, 0f, 1f, android.graphics.Color.BLACK)
    }
    val hud = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = android.graphics.Color.WHITE
        typeface = Typeface.DEFAULT_BOLD
        setShadowLayer(4f, 0f, 2f, android.graphics.Color.BLACK)
    }
}

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

fun DrawScope.drawArena(conn: ArenaConnection, start: StartMsg, controls: TouchControls, paints: ArenaPaints, nowNanos: Long) {
    val cur = conn.current ?: return
    val prev = conn.previous
    // Render between the previous and the latest snapshot so movement looks smooth.
    val t = ((nowNanos - conn.currentAtNanos) / TICK_NANOS).coerceIn(0f, 1f)
    val prevPlayers = prev?.players?.associateBy { it.id }.orEmpty()
    val prevBullets = prev?.bullets?.associateBy { it.id }.orEmpty()
    fun posOf(p: PlayerSnap): Offset {
        val q = prevPlayers[p.id]?.takeIf { it.alive == p.alive } ?: p
        return Offset(lerp(q.x, p.x, t), lerp(q.y, p.y, t))
    }

    val map = start.map
    val tile = map.tile.toFloat()
    val worldW = map.cols * tile
    val worldH = map.rows * tile
    val scale = size.height / VIEW_HEIGHT
    val viewW = size.width / scale
    val me = cur.players.find { it.id == start.you }
    val mePos = me?.let { posOf(it) } ?: Offset(worldW / 2, worldH / 2)
    val camX = if (viewW >= worldW) worldW / 2 else mePos.x.coerceIn(viewW / 2, worldW - viewW / 2)
    val camY = mePos.y.coerceIn(VIEW_HEIGHT / 2, worldH - VIEW_HEIGHT / 2)
    val left = camX - viewW / 2
    val top = camY - VIEW_HEIGHT / 2

    withTransform({
        scale(scale, scale, pivot = Offset.Zero)
        translate(-left, -top)
    }) {
        val c0 = floor(left / tile).toInt().coerceAtLeast(0)
        val c1 = floor((left + viewW) / tile).toInt().coerceAtMost(map.cols - 1)
        val r0 = floor(top / tile).toInt().coerceAtLeast(0)
        val r1 = floor((top + VIEW_HEIGHT) / tile).toInt().coerceAtMost(map.rows - 1)

        for (r in r0..r1) for (c in c0..c1) {
            val o = Offset(c * tile, r * tile)
            val ch = map.tileAt(c, r)
            if (ch == '#') {
                drawRect(WALL, o, Size(tile, tile))
                drawRect(WALL_TOP, o, Size(tile, tile * 0.7f))
            } else if (ch == 'A' || ch == 'B') {
                drawRect(TEAM_COLORS[if (ch == 'A') 0 else 1].copy(alpha = 0.55f), o, Size(tile, tile))
                for (k in 1..3) drawLine(Color.White.copy(alpha = 0.5f), o + Offset(0f, k * tile / 4), o + Offset(tile, k * tile / 4), 2f)
            } else {
                drawRect(if ((r + c) % 2 == 0) FLOOR_A else FLOOR_B, o, Size(tile, tile))
            }
        }

        // Aim guide while the right thumb is dragging.
        val aim = controls.aimVector()
        if (me != null && me.alive && aim != Offset.Zero) {
            val angle = kotlin.math.atan2(aim.y, aim.x)
            val guide = Color.White.copy(alpha = 0.45f)
            fun ray(a: Float, range: Float) = drawLine(guide, mePos, mePos + Offset(cos(a), sin(a)) * range, strokeWidth = 12f)
            when {
                cur.ball?.h == start.you -> ray(angle, KICK_RANGE)
                me.w == "shotgun" -> {
                    ray(angle - SHOTGUN_SPREAD / 2, SHOTGUN_RANGE)
                    ray(angle, SHOTGUN_RANGE)
                    ray(angle + SHOTGUN_SPREAD / 2, SHOTGUN_RANGE)
                }
                else -> ray(angle, BULLET_RANGE)
            }
        }
        fun isAlly(team: Int) = start.isFootball && team == start.team

        for (b in cur.bullets) {
            val q = prevBullets[b.id] ?: b
            val pos = Offset(lerp(q.x, b.x, t), lerp(q.y, b.y, t))
            val color = when {
                b.o == start.you -> Color(0xFFFFF176)
                isAlly(b.tm) -> Color(0xFF81D4FA)
                else -> Color(0xFFFF5252)
            }
            drawCircle(Color.Black.copy(alpha = 0.3f), if (b.s) 13f else 11f, pos + Offset(0f, 4f))
            drawCircle(color, if (b.s) 12f else 9f, pos)
        }

        val radius = map.playerRadius.toFloat()
        for (p in cur.players.filter { it.alive }) {
            val pos = posOf(p)
            val color = if (start.isFootball) TEAM_COLORS[p.tm.coerceIn(0, 1)] else PLAYER_COLORS[p.c % PLAYER_COLORS.size]
            drawCircle(Color.Black.copy(alpha = 0.25f), radius, pos + Offset(0f, 6f))
            drawCircle(color, radius, pos)
            drawCircle(if (p.id == start.you) Color.White else Color.Black.copy(alpha = 0.6f), radius, pos, style = Stroke(4f))
            val gun = Offset(cos(p.f), sin(p.f))
            drawLine(Color(0xFF37474F), pos + gun * (radius * 0.5f), pos + gun * (radius + 16f), strokeWidth = 12f)

            val barW = 70f
            val barTop = pos.y - radius - 22f
            drawRoundRect(Color.Black.copy(alpha = 0.6f), Offset(pos.x - barW / 2 - 2, barTop - 2), Size(barW + 4, 12f), CornerRadius(4f))
            val hpColor = when {
                p.id == start.you -> Color(0xFF66BB6A)
                isAlly(p.tm) -> Color(0xFF42A5F5)
                else -> Color(0xFFEF5350)
            }
            drawRoundRect(hpColor, Offset(pos.x - barW / 2, barTop), Size(barW * p.hp / p.maxHp, 8f), CornerRadius(3f))
            drawContext.canvas.nativeCanvas.drawText(p.name, pos.x, barTop - 8f, paints.name)

            if (p.id == start.you) {
                val ammo = cur.me?.ammo ?: 0f
                for (i in 0 until 3) {
                    val fill = (ammo - i).coerceIn(0f, 1f)
                    val o = Offset(pos.x - 33f + i * 23f, pos.y + radius + 10f)
                    drawRect(Color.Black.copy(alpha = 0.5f), o, Size(20f, 7f))
                    drawRect(Color(0xFFFFA726), o, Size(20f * fill, 7f))
                }
            }
        }

        cur.ball?.let { b ->
            val q = prev?.ball ?: b
            val pos = if (b.h != null) Offset(b.x, b.y) else Offset(lerp(q.x, b.x, t), lerp(q.y, b.y, t))
            drawCircle(Color.Black.copy(alpha = 0.3f), b.r, pos + Offset(0f, 6f))
            drawCircle(Color.White, b.r, pos)
            drawCircle(Color(0xFF263238), b.r * 0.4f, pos)
            drawCircle(Color(0xFF263238), b.r, pos, style = Stroke(3f))
        }

        // Bushes on top so they hide whoever stands inside; see-through around your own fighter.
        for (r in r0..r1) for (c in c0..c1) {
            if (map.tileAt(c, r) != 'b') continue
            val center = Offset(c * tile + tile / 2, r * tile + tile / 2)
            val near = (center - mePos).getDistance() < tile * 1.6f
            drawRoundRect(BUSH.copy(alpha = if (near) 0.45f else 0.95f), Offset(c * tile - 2, r * tile - 2), Size(tile + 4, tile + 4), CornerRadius(18f))
        }
    }

    drawHud(cur.left, me, cur, controls, paints, start)
}

private fun DrawScope.drawHud(
    leftMs: Long,
    me: PlayerSnap?,
    cur: com.fightingarena.app.arena.StateMsg,
    controls: TouchControls,
    paints: ArenaPaints,
    start: StartMsg,
) {
    val canvas = drawContext.canvas.nativeCanvas
    val unit = size.height / 360f
    paints.hud.textSize = 18f * unit

    val secs = (leftMs / 1000).toInt()
    paints.hud.textAlign = Paint.Align.CENTER
    canvas.drawText("%d:%02d".format(secs / 60, secs % 60), size.width / 2, 26f * unit, paints.hud)

    cur.score?.let { score ->
        paints.hud.textSize = 22f * unit
        paints.hud.color = TEAM_COLORS[0].toArgb()
        canvas.drawText("${score[0]}", size.width / 2 - 34f * unit, 52f * unit, paints.hud)
        paints.hud.color = android.graphics.Color.WHITE
        canvas.drawText(":", size.width / 2, 52f * unit, paints.hud)
        paints.hud.color = TEAM_COLORS[1].toArgb()
        canvas.drawText("${score[1]}", size.width / 2 + 34f * unit, 52f * unit, paints.hud)
        paints.hud.color = android.graphics.Color.WHITE
        paints.hud.textSize = 18f * unit
    }

    paints.hud.textAlign = Paint.Align.LEFT
    canvas.drawText("Убийства: ${me?.k ?: 0}", 16f * unit, 26f * unit, paints.hud)

    cur.goal?.let { g ->
        paints.hud.textAlign = Paint.Align.CENTER
        paints.hud.textSize = 40f * unit
        paints.hud.color = TEAM_COLORS[g.team.coerceIn(0, 1)].toArgb()
        canvas.drawText("ГОЛ!", size.width / 2, size.height * 0.4f, paints.hud)
        paints.hud.color = android.graphics.Color.WHITE
        paints.hud.textSize = 16f * unit
        if (g.scorer.isNotEmpty()) canvas.drawText(g.scorer, size.width / 2, size.height * 0.4f + 26f * unit, paints.hud)
        paints.hud.textSize = 18f * unit
    }

    paints.hud.textAlign = Paint.Align.RIGHT
    paints.hud.textSize = 12f * unit
    cur.feed.filter { cur.time - it.time < 5000 }.forEachIndexed { i, k ->
        canvas.drawText("${k.killer} ✕ ${k.victim}", size.width - 16f * unit, (22f + i * 16f) * unit, paints.hud)
    }

    // Joysticks.
    controls.move?.let { drawStick(it, controls.stickRadius, Color.White) }
    controls.aim?.let { drawStick(it, controls.stickRadius, Color(0xFFFFCA28)) }

    // Super button with its charge.
    val sup = cur.me?.sup ?: 0f
    val center = controls.superCenter(IntSize(size.width.toInt(), size.height.toInt()))
    val r = controls.superRadius
    drawCircle(Color.Black.copy(alpha = 0.4f), r, center)
    drawArc(
        if (sup >= 1f) Color(0xFFFFCA28) else Color(0xFF90A4AE),
        -90f, 360f * sup, useCenter = false,
        topLeft = center - Offset(r, r), size = Size(r * 2, r * 2), style = Stroke(6f),
    )
    if (sup >= 1f) drawCircle(Color(0xFFFFCA28).copy(alpha = 0.8f), r * 0.75f, center)
    paints.hud.textAlign = Paint.Align.CENTER
    paints.hud.textSize = 11f * unit
    canvas.drawText("СУПЕР", center.x, center.y + 4f * unit, paints.hud)

    if (me != null && !me.alive) {
        drawRect(Color.Black.copy(alpha = 0.45f))
        paints.hud.textSize = 24f * unit
        val left = ((cur.me?.respawnIn ?: 0L) / 1000f).let { kotlin.math.ceil(it).toInt() }
        canvas.drawText("Возрождение через $left", size.width / 2, size.height / 2, paints.hud)
    }
}

private fun DrawScope.drawStick(stick: Stick, radius: Float, color: Color) {
    drawCircle(Color.Black.copy(alpha = 0.25f), radius, stick.origin)
    drawCircle(color.copy(alpha = 0.35f), radius, stick.origin, style = Stroke(4f))
    val d = stick.pos - stick.origin
    val len = d.getDistance()
    val knob = if (len > radius) stick.origin + d * (radius / len) else stick.pos
    drawCircle(color.copy(alpha = 0.7f), radius * 0.4f, knob)
}
