package com.fightingarena.app.ui

import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.IntSize
import com.fightingarena.app.arena.ArenaConnection
import com.fightingarena.app.arena.PlayerSnap
import com.fightingarena.app.arena.StartMsg
import com.fightingarena.app.arena.StateMsg
import com.fightingarena.app.data.AimShape
import com.fightingarena.app.data.BrawlerInfo
import com.fightingarena.app.data.brawler
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

private const val VIEW_HEIGHT = 780f // world units visible vertically
private const val KICK_RANGE = 700f
private const val BOX_HP = 3600f
private const val GOAL_HALF_WIDTH = 120f

private val BLUE = Color(0xFF42A5F5)
private val RED = Color(0xFFEF5350)
private val ME = Color(0xFF66BB6A)
private val FLOOR_A = Color(0xFFD9B98A)
private val FLOOR_B = Color(0xFFD2B080)
private val WALL = Color(0xFF7A4E2D)
private val WALL_TOP = Color(0xFF9C6A40)
private val BOX = Color(0xFFB9772F)
private val BOX_EDGE = Color(0xFF6D4316)
private val BUSH = Color(0xFF2E7D32)
private val CUBE = Color(0xFF9CCC65)
private val GAS = Color(0xFF43A047)
private val GUIDE = Color.White.copy(alpha = 0.4f)
private val SUPER_GUIDE = Color(0xFFFFCA28).copy(alpha = 0.45f)

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
private fun dir(a: Float) = Offset(cos(a), sin(a))

fun DrawScope.drawArena(
    conn: ArenaConnection,
    start: StartMsg,
    controls: TouchControls,
    paints: ArenaPaints,
    predicted: Offset?,
    local: LocalShots,
    nowNanos: Long,
) {
    val latest = conn.latest ?: return
    // Everyone else is drawn slightly in the past, between two snapshots, so movement looks smooth.
    val frame = conn.frame(nowNanos) ?: return
    val cur = frame.b
    val prev = frame.a
    val t = frame.t
    val prevPlayers = prev.players.associateBy { it.id }
    val prevShots = prev.shots.associateBy { it.id }
    fun posOf(p: PlayerSnap): Offset {
        if (p.id == start.you && predicted != null) return predicted
        val q = prevPlayers[p.id]?.takeIf { it.alive == p.alive } ?: p
        return Offset(lerp(q.x, p.x, t), lerp(q.y, p.y, t))
    }
    fun isAlly(team: Int) = start.mode != "survival" && team == start.team
    fun sideColor(team: Int, owner: Int) = when {
        owner == start.you -> ME
        isAlly(team) -> BLUE
        else -> RED
    }

    val map = start.map
    val tile = map.tile.toFloat()
    val worldW = map.cols * tile
    val worldH = map.rows * tile
    val scale = size.height / VIEW_HEIGHT
    val viewW = size.width / scale
    val me = cur.players.find { it.id == start.you }
    val mine = brawler(start.brawler)
    // A knocked-out duo player watches the partner.
    val focus = me?.takeIf { it.alive } ?: cur.players.find { it.id == cur.me?.follow } ?: me
    val center = focus?.let { posOf(it) } ?: Offset(worldW / 2, worldH / 2)
    val camX = if (viewW >= worldW) worldW / 2 else center.x.coerceIn(viewW / 2, worldW - viewW / 2)
    val camY = center.y.coerceIn(VIEW_HEIGHT / 2, worldH - VIEW_HEIGHT / 2)
    val left = camX - viewW / 2
    val top = camY - VIEW_HEIGHT / 2
    val mePos = me?.let { posOf(it) } ?: center
    val boxes = cur.boxes?.associate { it[0] to it[1] }

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
            when (map.tileAt(c, r)) {
                '#' -> {
                    drawRect(WALL, o, Size(tile, tile))
                    drawRect(WALL_TOP, o, Size(tile, tile * 0.7f))
                }
                else -> drawRect(if ((r + c) % 2 == 0) FLOOR_A else FLOOR_B, o, Size(tile, tile))
            }
        }
        // Boxes: unbroken ones come with every snapshot, darker as they take damage.
        if (boxes != null) for (r in r0..r1) for (c in c0..c1) {
            if (map.tileAt(c, r) != 'x') continue
            val hp = boxes[r * map.cols + c] ?: continue
            val o = Offset(c * tile + 4, r * tile + 4)
            val s = Size(tile - 8, tile - 8)
            drawRoundRect(lerpColor(BOX_EDGE, BOX, hp / BOX_HP), o, s, CornerRadius(6f))
            drawRoundRect(BOX_EDGE, o, s, CornerRadius(6f), style = Stroke(4f))
            drawLine(BOX_EDGE, o, o + Offset(s.width, s.height), 3f)
            drawLine(BOX_EDGE, o + Offset(s.width, 0f), o + Offset(0f, s.height), 3f)
        }

        if (start.mode == "ball") {
            for (team in 0..1) {
                val y0 = if (team == 0) worldH - 2 * tile else tile
                drawRect((if (isAlly(team)) BLUE else RED).copy(alpha = 0.5f), Offset(worldW / 2 - GOAL_HALF_WIDTH, y0), Size(GOAL_HALF_WIDTH * 2, tile))
                for (k in 1..3) {
                    val y = y0 + k * tile / 4
                    drawLine(Color.White.copy(alpha = 0.5f), Offset(worldW / 2 - GOAL_HALF_WIDTH, y), Offset(worldW / 2 + GOAL_HALF_WIDTH, y), 2f)
                }
            }
            drawLine(Color.White.copy(alpha = 0.35f), Offset(6 * tile, worldH / 2), Offset(worldW - 6 * tile, worldH / 2), 4f)
            drawCircle(Color.White.copy(alpha = 0.35f), 110f, Offset(worldW / 2, worldH / 2), style = Stroke(4f))
        }

        cur.beacon?.let { b ->
            val blink = (nowNanos / 250_000_000L) % 2 == 0L
            val color = when {
                b.s == 2 -> if (blink) Color(0xFFFFEB3B) else Color(0xFFFFA000)
                b.s < 0 -> Color.White
                isAlly(b.s) -> BLUE
                else -> RED
            }
            val c = Offset(worldW / 2, worldH / 2)
            drawCircle(color.copy(alpha = 0.25f), start.beaconRadius.toFloat(), c)
            drawCircle(color.copy(alpha = 0.8f), start.beaconRadius.toFloat(), c, style = Stroke(6f))
        }

        for (z in cur.zones) {
            val color = if (isAlly(z.tm) || z.tm == me?.tm) Color(0xFF81D4FA) else Color(0xFFB3E5FC)
            drawCircle(color.copy(alpha = 0.35f), z.r, Offset(z.x, z.y))
            drawCircle(Color.White.copy(alpha = 0.7f), z.r, Offset(z.x, z.y), style = Stroke(3f))
        }

        for (c in cur.cubes) {
            val o = Offset(c.x - 14f, c.y - 14f)
            drawRoundRect(Color.Black.copy(alpha = 0.3f), o + Offset(0f, 4f), Size(28f, 28f), CornerRadius(5f))
            drawRoundRect(CUBE, o, Size(28f, 28f), CornerRadius(5f))
            drawRoundRect(Color(0xFF33691E), o, Size(28f, 28f), CornerRadius(5f), style = Stroke(3f))
        }

        if (me != null && me.alive) drawAimGuides(controls, cur, start, mine, mePos)

        for (s in cur.shots) {
            val q = prevShots[s.id] ?: s
            val pos = Offset(lerp(q.x, s.x, t), lerp(q.y, s.y, t))
            if (local.covers(s.k, s.o, s.s, pos)) continue
            val color = sideColor(s.tm, s.o).let { if (s.o == start.you) Color(0xFFFFF176) else it }
            when (s.k) {
                "bomb" -> {
                    val target = Offset(s.tx ?: s.x, s.ty ?: s.y)
                    drawCircle(color.copy(alpha = 0.25f), s.br ?: 80f, target)
                    drawCircle(color.copy(alpha = 0.6f), s.br ?: 80f, target, style = Stroke(3f))
                    val lift = sin(PI.toFloat() * (s.z ?: 0f)) * 90f
                    drawCircle(Color.Black.copy(alpha = 0.3f), 12f, pos)
                    drawCircle(Color(0xFF37474F), 14f, pos - Offset(0f, lift))
                    drawCircle(color, 6f, pos - Offset(0f, lift + 10f))
                }
                "boomerang" -> {
                    val spin = (nowNanos / 20_000_000L % 360).toFloat() * PI.toFloat() / 180f * 8f
                    for (k in 0..1) {
                        val d = dir(spin + k * PI.toFloat() / 2) * 18f
                        drawLine(color, pos - d, pos + d, strokeWidth = 8f)
                    }
                }
                else -> {
                    drawCircle(Color.Black.copy(alpha = 0.3f), if (s.s) 12f else 10f, pos + Offset(0f, 4f))
                    drawCircle(color, if (s.s) 11f else 8f, pos)
                }
            }
        }

        drawLocalShots(local, nowNanos)

        for (u in cur.turrets) {
            val pos = Offset(u.x, u.y)
            val color = sideColor(u.tm, if (u.o == start.you) start.you else -1)
            drawRoundRect(Color.Black.copy(alpha = 0.3f), pos - Offset(22f, 18f), Size(44f, 44f), CornerRadius(8f))
            drawRoundRect(Color(0xFF546E7A), pos - Offset(22f, 22f), Size(44f, 44f), CornerRadius(8f))
            drawCircle(color, 12f, pos)
            drawHpBar(pos, 30f, u.hp.toFloat() / u.maxHp, color, 56f)
        }

        val radius = map.playerRadius.toFloat()
        for (p in cur.players.filter { it.alive }.sortedBy { it.air ?: 0f }) {
            val info = brawler(p.b)
            val base = posOf(p)
            val air = p.air?.let { sin(PI.toFloat() * it) } ?: 0f
            val pos = base - Offset(0f, air * 60f)
            val r = radius * (1f + 0.3f * air)
            val alpha = if (p.inv) 0.4f else 1f
            val side = when {
                p.id == start.you -> Color.White
                isAlly(p.tm) -> BLUE
                else -> RED
            }
            drawCircle(Color.Black.copy(alpha = 0.25f * alpha), radius, base + Offset(0f, 6f))
            drawCircle(info.color.copy(alpha = alpha), r, pos)
            if (p.sl) drawCircle(Color(0xFF81D4FA).copy(alpha = 0.5f), r, pos)
            drawCircle(side.copy(alpha = alpha), r, pos, style = Stroke(5f))
            val face = dir(p.f)
            drawLine(Color(0xFF263238).copy(alpha = alpha), pos + face * (r * 0.5f), pos + face * (r + 14f), strokeWidth = 10f)
            if (p.sh) drawCircle(Color(0xFFFFF59D).copy(alpha = 0.6f), r + 10f, pos, style = Stroke(5f))
            paints.name.textSize = 22f
            drawContext.canvas.nativeCanvas.drawText(info.name.take(1), pos.x, pos.y + 8f, paints.name)

            val barTop = pos.y - r - 22f
            val hpColor = when {
                p.id == start.you -> ME
                isAlly(p.tm) -> BLUE
                else -> RED
            }
            drawHpBar(Offset(pos.x, barTop), 70f, p.hp.toFloat() / p.maxHp, hpColor, 0f)
            paints.name.textSize = 18f
            val label = if (p.cu > 0) "${p.name} ◆${p.cu}" else p.name
            drawContext.canvas.nativeCanvas.drawText(label, pos.x, barTop - 8f, paints.name)

            if (p.id == start.you) {
                val ammo = latest.me?.ammo ?: 0f
                for (i in 0 until 3) {
                    val fill = (ammo - i).coerceIn(0f, 1f)
                    val o = Offset(pos.x - 33f + i * 23f, pos.y + r + 10f)
                    drawRect(Color.Black.copy(alpha = 0.5f), o, Size(20f, 7f))
                    drawRect(Color(0xFFFFA726), o, Size(20f * fill, 7f))
                }
            }
        }

        cur.ball?.let { b ->
            val q = prev.ball ?: b
            val pos = if (b.h != null) Offset(b.x, b.y) else Offset(lerp(q.x, b.x, t), lerp(q.y, b.y, t))
            drawCircle(Color.Black.copy(alpha = 0.3f), b.r, pos + Offset(0f, 6f))
            drawCircle(Color.White, b.r, pos)
            drawCircle(Color(0xFF263238), b.r * 0.4f, pos)
            drawCircle(Color(0xFF263238), b.r, pos, style = Stroke(3f))
        }

        for (e in cur.fx) {
            if (e.k == "slash" && local.slashes.isNotEmpty()) continue // already drawn by the phone
            val fade = (1f - e.age / 400f).coerceIn(0f, 1f)
            val pos = Offset(e.x, e.y)
            when (e.k) {
                "slash" -> drawArc(
                    Color.White.copy(alpha = 0.6f * fade),
                    startAngle = Math.toDegrees((e.a - 0.95).toDouble()).toFloat(),
                    sweepAngle = Math.toDegrees(1.9).toFloat(),
                    useCenter = true,
                    topLeft = pos - Offset(e.r, e.r),
                    size = Size(e.r * 2, e.r * 2),
                )
                else -> {
                    drawCircle(Color(0xFFFFB74D).copy(alpha = 0.6f * fade), e.r * (0.6f + 0.4f * (1 - fade)), pos)
                    drawCircle(Color.White.copy(alpha = 0.8f * fade), e.r, pos, style = Stroke(4f))
                }
            }
        }

        // Bushes on top so they hide whoever stands inside; see-through around your own brawler.
        for (r in r0..r1) for (c in c0..c1) {
            if (map.tileAt(c, r) != 'b') continue
            val tc = Offset(c * tile + tile / 2, r * tile + tile / 2)
            val near = (tc - mePos).getDistance() < tile * 1.6f
            drawRoundRect(BUSH.copy(alpha = if (near) 0.45f else 0.95f), Offset(c * tile - 2, r * tile - 2), Size(tile + 4, tile + 4), CornerRadius(18f))
        }

        cur.gas?.let { radius ->
            val gas = Path().apply {
                fillType = PathFillType.EvenOdd
                addRect(Rect(0f, 0f, worldW, worldH))
                addOval(Rect(Offset(worldW / 2, worldH / 2), radius))
            }
            drawPath(gas, GAS.copy(alpha = 0.4f))
            drawCircle(GAS, radius, Offset(worldW / 2, worldH / 2), style = Stroke(6f))
        }
    }

    drawHud(latest.players.find { it.id == start.you }, latest, controls, paints, start, mine)
}

private fun lerpColor(a: Color, b: Color, k: Float): Color {
    val t = k.coerceIn(0f, 1f)
    return Color(lerp(a.red, b.red, t), lerp(a.green, b.green, t), lerp(a.blue, b.blue, t), 1f)
}

private fun DrawScope.drawHpBar(at: Offset, width: Float, share: Float, color: Color, offsetY: Float) {
    val top = at.y - offsetY
    drawRoundRect(Color.Black.copy(alpha = 0.6f), Offset(at.x - width / 2 - 2, top - 2), Size(width + 4, 12f), CornerRadius(4f))
    drawRoundRect(color, Offset(at.x - width / 2, top), Size(width * share.coerceIn(0f, 1f), 8f), CornerRadius(3f))
}

/** Translucent hints on the ground while aiming: line, fan, arc or landing circle. */
private fun DrawScope.drawAimGuides(controls: TouchControls, cur: StateMsg, start: StartMsg, b: BrawlerInfo, from: Offset) {
    val aim = controls.aimVector()
    if (aim != Offset.Zero) {
        val a = atan2(aim.y, aim.x)
        if (cur.ball?.h == start.you) ray(from, a, KICK_RANGE, GUIDE)
        else when (b.aim) {
            AimShape.ARC -> drawArc(
                GUIDE,
                startAngle = Math.toDegrees((a - 0.95).toDouble()).toFloat(),
                sweepAngle = Math.toDegrees(1.9).toFloat(),
                useCenter = true,
                topLeft = from - Offset(b.range.toFloat(), b.range.toFloat()),
                size = Size(b.range * 2f, b.range * 2f),
            )
            AimShape.FAN -> {
                val spread = if (b.id == "spark") 0.22f else 0.08f
                for (k in -1..1) ray(from, a + k * spread, b.range.toFloat(), GUIDE)
            }
            AimShape.THROW -> throwGuide(from, a, (aim.getDistance() * b.range).coerceAtLeast(70f), 85f, GUIDE)
            else -> ray(from, a, b.range.toFloat(), GUIDE)
        }
    }
    val sup = controls.superVector()
    if (sup != Offset.Zero) {
        val a = atan2(sup.y, sup.x)
        val range = b.superRange.toFloat()
        when (b.superAim) {
            AimShape.THROW -> throwGuide(from, a, (sup.getDistance() * range).coerceAtLeast(70f), if (b.id == "hammer") 130f else 150f, SUPER_GUIDE)
            AimShape.FAN -> {
                val spread = if (b.id == "boomer") 0.3f else 0.24f
                for (k in -1..1) ray(from, a + k * spread, range, SUPER_GUIDE)
            }
            AimShape.SELF -> drawCircle(SUPER_GUIDE, 40f, from + dir(a) * range)
            else -> ray(from, a, range, SUPER_GUIDE)
        }
    }
}

private fun DrawScope.ray(from: Offset, a: Float, range: Float, color: Color) =
    drawLine(color, from, from + dir(a) * range, strokeWidth = 12f)

private fun DrawScope.throwGuide(from: Offset, a: Float, dist: Float, radius: Float, color: Color) {
    val at = from + dir(a) * dist
    drawLine(color, from, at, strokeWidth = 4f)
    drawCircle(color, radius, at)
}

private fun DrawScope.drawHud(me: PlayerSnap?, cur: StateMsg, controls: TouchControls, paints: ArenaPaints, start: StartMsg, mine: BrawlerInfo) {
    val canvas = drawContext.canvas.nativeCanvas
    val unit = size.height / 360f
    val white = android.graphics.Color.WHITE
    paints.hud.textSize = 18f * unit
    paints.hud.color = white
    paints.hud.textAlign = Paint.Align.CENTER

    if (start.isSurvival) {
        val label = if (start.mode == "duo") "Пар в игре" else "Бойцов в игре"
        canvas.drawText("$label: ${cur.teamsLeft ?: 0}", size.width / 2, 26f * unit, paints.hud)
    } else {
        val secs = (cur.left / 1000).toInt()
        canvas.drawText("%d:%02d".format(secs / 60, secs % 60), size.width / 2, 26f * unit, paints.hud)
    }

    val my = start.team.coerceIn(0, 1)
    cur.score?.let { score ->
        paints.hud.textSize = 22f * unit
        paints.hud.color = BLUE.toArgb()
        canvas.drawText("${score[my]}", size.width / 2 - 34f * unit, 52f * unit, paints.hud)
        paints.hud.color = white
        canvas.drawText(":", size.width / 2, 52f * unit, paints.hud)
        paints.hud.color = RED.toArgb()
        canvas.drawText("${score[1 - my]}", size.width / 2 + 34f * unit, 52f * unit, paints.hud)
        paints.hud.color = white
    }

    cur.beacon?.let { b ->
        val w = 110f * unit
        val h = 9f * unit
        val y = 36f * unit
        listOf(b.p[my] to BLUE, b.p[1 - my] to RED).forEachIndexed { i, (share, color) ->
            val x = if (i == 0) size.width / 2 - w - 8f * unit else size.width / 2 + 8f * unit
            drawRoundRect(Color.Black.copy(alpha = 0.5f), Offset(x, y), Size(w, h), CornerRadius(4f))
            drawRoundRect(color, Offset(x, y), Size(w * share, h), CornerRadius(4f))
        }
        paints.hud.textSize = 12f * unit
        canvas.drawText("${(b.p[my] * 100).toInt()}% : ${(b.p[1 - my] * 100).toInt()}%", size.width / 2, 60f * unit, paints.hud)
    }

    paints.hud.textAlign = Paint.Align.LEFT
    paints.hud.textSize = 14f * unit
    canvas.drawText("${mine.name} · победил ${me?.k ?: 0}", 16f * unit, 24f * unit, paints.hud)
    if (start.isSurvival) canvas.drawText("Кубы силы: ${me?.cu ?: 0}", 16f * unit, 42f * unit, paints.hud)

    cur.goal?.let { g ->
        paints.hud.textAlign = Paint.Align.CENTER
        paints.hud.textSize = 40f * unit
        paints.hud.color = (if (g.team == start.team) BLUE else RED).toArgb()
        canvas.drawText("ГОЛ!", size.width / 2, size.height * 0.4f, paints.hud)
        paints.hud.color = white
        paints.hud.textSize = 16f * unit
        if (g.scorer.isNotEmpty()) canvas.drawText(g.scorer, size.width / 2, size.height * 0.4f + 26f * unit, paints.hud)
    }
    if (cur.pause > 0 && cur.goal == null) {
        paints.hud.textAlign = Paint.Align.CENTER
        paints.hud.textSize = 30f * unit
        canvas.drawText("Приготовьтесь!", size.width / 2, size.height * 0.4f, paints.hud)
    }

    paints.hud.textAlign = Paint.Align.RIGHT
    paints.hud.textSize = 12f * unit
    cur.feed.filter { cur.time - it.time < 5000 }.forEachIndexed { i, k ->
        canvas.drawText("${k.killer} ✕ ${k.victim}", size.width - 16f * unit, (22f + i * 16f) * unit, paints.hud)
    }

    // Joysticks.
    controls.move?.let { drawStick(it, controls.stickRadius, Color.White) }
    controls.aim?.let { drawStick(it, controls.stickRadius, Color(0xFFFFCA28)) }

    // Super button with its charge; it can also be dragged to aim.
    val sup = cur.me?.sup ?: 0f
    val blocked = cur.ball?.h == start.you
    val center = controls.superCenter(IntSize(size.width.toInt(), size.height.toInt()))
    val r = controls.superRadius
    drawCircle(Color.Black.copy(alpha = 0.4f), r, center)
    drawArc(
        if (sup >= 1f && !blocked) Color(0xFFFFCA28) else Color(0xFF90A4AE),
        -90f, 360f * sup, useCenter = false,
        topLeft = center - Offset(r, r), size = Size(r * 2, r * 2), style = Stroke(6f),
    )
    if (sup >= 1f && !blocked) drawCircle(Color(0xFFFFCA28).copy(alpha = 0.8f), r * 0.75f, center)
    controls.superStick?.let { drawStick(it, controls.stickRadius, Color(0xFFFFCA28)) }
    paints.hud.textAlign = Paint.Align.CENTER
    paints.hud.textSize = 11f * unit
    canvas.drawText("СУПЕР", center.x, center.y + 4f * unit, paints.hud)

    if (me != null && !me.alive && cur.me?.out != true) {
        drawRect(Color.Black.copy(alpha = 0.35f))
        paints.hud.textSize = 24f * unit
        val left = ceil((cur.me?.respawnIn ?: 0L) / 1000f).toInt()
        canvas.drawText("Возвращение через $left", size.width / 2, size.height / 2, paints.hud)
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

/** Your own attack, drawn the moment you fire (see LocalShots). */
private fun DrawScope.drawLocalShots(local: LocalShots, nowNanos: Long) {
    val mine = Color(0xFFFFF176)
    for (s in local.shots) {
        val pos = Offset(s.x, s.y)
        drawCircle(Color.Black.copy(alpha = 0.3f), 10f, pos + Offset(0f, 4f))
        drawCircle(mine, 8f, pos)
    }
    for (b in local.bombs) {
        val k = ((nowNanos - b.bornNanos) / 550_000_000f).coerceIn(0f, 1f)
        val pos = b.from + (b.to - b.from) * k
        drawCircle(mine.copy(alpha = 0.25f), 85f, b.to)
        drawCircle(mine.copy(alpha = 0.6f), 85f, b.to, style = Stroke(3f))
        val lift = sin(PI.toFloat() * k) * 90f
        drawCircle(Color.Black.copy(alpha = 0.3f), 12f, pos)
        drawCircle(Color(0xFF37474F), 14f, pos - Offset(0f, lift))
    }
    for (sl in local.slashes) {
        val fade = (1f - (nowNanos - sl.bornNanos) / 300_000_000f).coerceIn(0f, 1f)
        drawArc(
            Color.White.copy(alpha = 0.6f * fade),
            startAngle = Math.toDegrees((sl.angle - 0.95).toDouble()).toFloat(),
            sweepAngle = Math.toDegrees(1.9).toFloat(),
            useCenter = true,
            topLeft = sl.at - Offset(150f, 150f),
            size = Size(300f, 300f),
        )
    }
}
