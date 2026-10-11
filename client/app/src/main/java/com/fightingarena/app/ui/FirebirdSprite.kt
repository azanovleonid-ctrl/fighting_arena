package com.fightingarena.app.ui

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

private val FIRE_RED = Color(0xFFE53935)
private val FIRE_ORANGE = Color(0xFFFF7043)
private val FIRE_GOLD = Color(0xFFFFC107)
private val FIRE_YELLOW = Color(0xFFFFEB3B)
private val FIRE_DARK = Color(0xFFB71C1C)
private val BIRD_LEG = Color(0xFFF9A825)
private val BIRD_LEG_BACK = Color(0xFFC17900)
private val GUN = Color(0xFF37474F)
private val GUN_LIGHT = Color(0xFF607D8B)
private val GUN_GLOW = Color(0xFF4DD0E1)
private const val PI_F = PI.toFloat()

/**
 * Искра as a firebird: walks on two legs, flame tail and crest sway, and holds a blaster in the
 * front wing. [recoil] runs from 1 down to 0 right after a shot.
 */
fun DrawScope.drawFirebird(pos: Offset, walk: WalkState, side: Color, alpha: Float, recoil: Float, timeS: Float) {
    val m = walk.moving
    val s = sin(walk.phase)
    val bob = abs(cos(walk.phase)) * 3f * m
    val wave = sin(timeS * 6f) * 0.12f
    fun c(color: Color) = color.copy(alpha = color.alpha * alpha)

    drawCircle(
        Brush.radialGradient(listOf(Color(0x59FF9800), Color(0x00FF9800)), center = pos + Offset(0f, -20f), radius = 46f),
        radius = 46f,
        center = pos + Offset(0f, -20f),
        alpha = alpha,
    )
    drawOval(c(Color.Black.copy(alpha = 0.25f)), pos + Offset(-24f, 12f), Size(48f, 18f))
    drawOval(c(side), pos + Offset(-28f, 10f), Size(56f, 24f), style = Stroke(4f))

    withTransform({
        translate(pos.x, pos.y)
        scale(if (walk.facingRight) 1f else -1f, 1f, pivot = Offset.Zero)
    }) {
        val by = -16f - bob

        // A flame feather from (x, y) pointing at angle a, l long and w wide.
        fun feather(x: Float, y: Float, a: Float, l: Float, w: Float, color: Color) {
            val dx = cos(a)
            val dy = sin(a)
            val nx = -dy
            val ny = dx
            val path = Path().apply {
                moveTo(x + nx * w, y + ny * w)
                quadraticTo(x + dx * l * 0.6f + nx * w * 1.2f, y + dy * l * 0.6f + ny * w * 1.2f, x + dx * l, y + dy * l)
                quadraticTo(x + dx * l * 0.6f - nx * w * 1.2f, y + dy * l * 0.6f - ny * w * 1.2f, x - nx * w, y - ny * w)
                close()
            }
            drawPath(path, c(color))
        }

        fun line(a: Offset, b: Offset, width: Float, color: Color) =
            drawLine(c(color), a, b, strokeWidth = width, cap = StrokeCap.Round)

        // Thin legs with three toes; the stepping foot lifts a little.
        fun leg(hipX: Float, swingX: Float, lift: Float, color: Color) {
            val knee = Offset(hipX + swingX * 0.5f, by + 26f - lift * 0.5f)
            val foot = Offset(hipX + swingX, by + 34f - lift)
            line(Offset(hipX, by + 14f), knee, 4f, color)
            line(knee, foot, 4f, color)
            line(foot, foot + Offset(8f, 1f), 3f, color)
            line(foot, foot + Offset(5f, 4f), 3f, color)
            line(foot, foot + Offset(-4f, 1f), 3f, color)
        }

        // Flame tail.
        feather(-12f, by + 4f, PI_F * 0.86f + wave, 40f, 7f, FIRE_DARK)
        feather(-12f, by + 2f, PI_F * 0.93f + wave * 1.3f, 46f, 6f, FIRE_RED)
        feather(-12f, by, PI_F + wave * 1.6f, 40f, 5f, FIRE_ORANGE)
        feather(-12f, by - 2f, PI_F * 1.08f + wave * 2f, 30f, 4f, FIRE_GOLD)

        leg(-5f, -s * 8f * m, max(0f, -s) * 6f * m, BIRD_LEG_BACK)
        feather(-2f, by - 6f, PI_F * 0.75f + s * 0.1f * m, 30f, 8f, FIRE_DARK) // back wing

        // Body with a golden breast.
        drawOval(c(FIRE_RED), Offset(-17f, by - 18f), Size(34f, 38f))
        drawOval(c(FIRE_GOLD), Offset(-8f, by - 8f), Size(18f, 26f))
        leg(5f, s * 8f * m, max(0f, s) * 6f * m, BIRD_LEG)

        // Head with a flame crest, beak and an eye.
        val h = Offset(8f, by - 28f)
        feather(h.x - 4f, h.y - 8f, -PI_F * 0.62f + wave, 20f, 4f, FIRE_ORANGE)
        feather(h.x - 1f, h.y - 10f, -PI_F * 0.5f + wave, 24f, 4f, FIRE_RED)
        feather(h.x + 3f, h.y - 9f, -PI_F * 0.38f + wave, 18f, 3.5f, FIRE_GOLD)
        drawCircle(c(FIRE_ORANGE), 12f, h)
        drawPath(
            Path().apply {
                moveTo(h.x + 9f, h.y - 4f)
                lineTo(h.x + 22f, h.y + 1f)
                lineTo(h.x + 9f, h.y + 5f)
                close()
            },
            c(FIRE_YELLOW),
        )
        drawCircle(c(Color.White), 3.2f, h + Offset(4f, -3f))
        drawCircle(c(Color(0xFF1A1A1A)), 1.8f, h + Offset(5f, -3f))
        line(h + Offset(-1f, -8f), h + Offset(8f, -7f), 2.2f, FIRE_DARK)

        // Front wing reaches forward under the blaster; the blaster kicks back on a shot.
        feather(-6f, by - 2f, PI_F * 0.06f, 26f, 7f, FIRE_RED)
        feather(-6f, by, PI_F * 0.1f, 21f, 5f, FIRE_ORANGE)
        val k = recoil.coerceIn(0f, 1f)
        val g = Offset(8f - k * 6f, by - 2f)
        drawRoundRect(c(GUN), g + Offset(0f, -7f), Size(28f, 13f), CornerRadius(4f))
        drawRoundRect(c(GUN_LIGHT), g + Offset(22f, -5f), Size(13f, 9f), CornerRadius(2f))
        drawRoundRect(c(GUN), g + Offset(5f, 4f), Size(7f, 10f), CornerRadius(2f))
        drawRoundRect(c(GUN_GLOW), g + Offset(3f, -4f), Size(14f, 4f), CornerRadius(2f))
        drawCircle(c(GUN_GLOW), 4f, g + Offset(36f, -0.5f))
        if (k > 0.4f) {
            drawCircle(c(Color(0xD9FFEB3B)), 9f * k, g + Offset(44f, 0f))
            drawCircle(c(Color.White), 5f * k, g + Offset(44f, 0f))
        }
        drawCircle(c(FIRE_ORANGE), 5f, g + Offset(6f, 1f)) // wing tip on the grip
    }
}
