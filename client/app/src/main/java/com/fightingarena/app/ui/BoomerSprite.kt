package com.fightingarena.app.ui

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawscope.withTransform
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

private val SKIN = Color(0xFFB5764A)
private val SKIN_DARK = Color(0xFF94592F)
private val HAIR = Color(0xFF1F1A17)
private val BAND = Color(0xFFC62828)
private val BEAD = Color(0xFF26A69A)
private val BEAD_GOLD = Color(0xFFFFEB3B)
private val LEATHER = Color(0xFFC8A165)
private val LEATHER_DARK = Color(0xFF9C7740)
private val PANTS = Color(0xFF6D4C41)
private val PANTS_BACK = Color(0xFF5D4037)
private val MOCCASIN = Color(0xFF8D6E63)
private val WOOD = Color(0xFFB07B3E)
private val WOOD_DARK = Color(0xFF7A4F22)
private val FEATHER = Color(0xFFFAFAFA)
private val FEATHER_TIP = Color(0xFF4E342E)
private val PAINT_RED = Color(0xFFE53935)

/**
 * Бумер as a warrior with a feather headdress and a wooden boomerang. [throwK] runs 0..1 through a
 * throw (wind-up behind the head, swing forward, back to rest); [holding] is false while his
 * boomerang is in the air.
 */
fun DrawScope.drawBoomer(pos: Offset, walk: WalkState, side: Color, alpha: Float, throwK: Float, holding: Boolean) {
    val m = walk.moving
    val s = sin(walk.phase)
    val bob = abs(cos(walk.phase)) * 3f * m
    fun c(color: Color) = color.copy(alpha = color.alpha * alpha)

    drawOval(c(Color.Black.copy(alpha = 0.25f)), pos + Offset(-24f, 12f), Size(48f, 18f))
    drawOval(c(side), pos + Offset(-28f, 10f), Size(56f, 24f), style = Stroke(4f))

    withTransform({
        translate(pos.x, pos.y)
        scale(if (walk.facingRight) 1f else -1f, 1f, pivot = Offset.Zero)
    }) {
        val by = -14f - bob
        fun rect(x: Float, y: Float, w: Float, h: Float, r: Float, color: Color) =
            drawRoundRect(c(color), Offset(x, y), Size(w, h), CornerRadius(r))

        // Legs in moccasins; the stepping foot lifts a little.
        fun leg(hipX: Float, swingX: Float, lift: Float, color: Color) {
            rect(hipX - 5f + swingX * 0.4f, by + 12f, 10f, 20f - lift, 4f, color)
            rect(hipX - 6f + swingX, by + 29f - lift, 14f, 6f, 3f, MOCCASIN)
        }

        // A feather from its base at (x, y) along angle a, with a dark tip.
        fun feather(x: Float, y: Float, a: Float, l: Float, w: Float, color: Color) {
            val dx = cos(a)
            val dy = sin(a)
            val nx = -dy
            val ny = dx
            drawPath(
                Path().apply {
                    moveTo(x, y)
                    quadraticTo(x + dx * l * 0.5f + nx * w, y + dy * l * 0.5f + ny * w, x + dx * l, y + dy * l)
                    quadraticTo(x + dx * l * 0.5f - nx * w, y + dy * l * 0.5f - ny * w, x, y)
                },
                c(color),
            )
            drawPath(
                Path().apply {
                    moveTo(x + dx * l * 0.72f + nx * w * 0.75f, y + dy * l * 0.72f + ny * w * 0.75f)
                    quadraticTo(x + dx * l * 0.9f, y + dy * l * 0.9f, x + dx * l, y + dy * l)
                    quadraticTo(x + dx * l * 0.9f, y + dy * l * 0.9f, x + dx * l * 0.72f - nx * w * 0.75f, y + dy * l * 0.72f - ny * w * 0.75f)
                    close()
                },
                c(FEATHER_TIP),
            )
        }

        leg(-5f, -s * 7f * m, max(0f, -s) * 6f * m, PANTS_BACK)
        rect(-17f, by - 12f + s * 3f * m, 8f, 22f, 4f, SKIN_DARK) // back arm
        rect(-11f, by - 30f, 6f, 26f, 3f, HAIR) // braid
        drawCircle(c(BAND), 3f, Offset(-8f, by - 4f))

        // Leather tunic with fringe and a bead stripe.
        rect(-13f, by - 16f, 26f, 30f, 7f, LEATHER)
        for (i in 0 until 6) rect(-12f + i * 4.4f, by + 12f, 2.4f, 6f, 1f, LEATHER_DARK)
        rect(-13f, by - 6f, 26f, 4f, 1f, BEAD)
        for (i in 0 until 5) drawCircle(c(PAINT_RED), 1.2f, Offset(-9f + i * 4.6f, by - 4f))
        leg(5f, s * 7f * m, max(0f, s) * 6f * m, PANTS)

        // Head, hair, feathers fanned up from the headband, face with war paint.
        val h = Offset(3f, by - 28f)
        drawCircle(c(SKIN), 12f, h)
        rect(h.x - 12f, h.y - 13f, 22f, 8f, 4f, HAIR)
        val fan = floatArrayOf(-2.2f, -1.95f, -1.7f, -1.45f, -1.2f)
        fan.forEachIndexed { i, a ->
            feather(h.x - 6f + i * 2.5f, h.y - 8f, a, 26f - abs(i - 2) * 3f, 4.5f, if (i == 2) PAINT_RED else FEATHER)
        }
        rect(h.x - 12f, h.y - 9f, 24f, 5f, 2f, BAND)
        drawCircle(c(BEAD), 1.3f, h + Offset(-6f, -6.5f))
        drawCircle(c(BEAD_GOLD), 1.3f, h + Offset(0f, -6.5f))
        drawCircle(c(BEAD), 1.3f, h + Offset(6f, -6.5f))
        drawCircle(c(Color(0xFF1A1A1A)), 2f, h + Offset(6f, -1f))
        drawLine(c(HAIR), h + Offset(3f, -4.5f), h + Offset(9f, -4f), strokeWidth = 1.8f)
        rect(h.x + 2f, h.y + 3f, 7f, 1.8f, 1f, PAINT_RED)
        rect(h.x + 2f, h.y + 6f, 7f, 1.8f, 1f, Color.White)
        drawCircle(c(SKIN), 2.2f, h + Offset(12f, 1f))

        // Throwing arm: at rest it holds the boomerang low; a throw winds up behind and swings forward.
        val k = throwK.coerceIn(0f, 1f)
        fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t
        val deg = when {
            k < 0.25f -> lerp(55f, -140f, k / 0.25f)
            k < 0.45f -> lerp(-140f, -10f, (k - 0.25f) / 0.2f)
            else -> lerp(-10f, 55f, (k - 0.45f) / 0.55f)
        }
        val ang = deg * PI.toFloat() / 180f
        val shoulder = Offset(6f, by - 10f)
        val hand = shoulder + Offset(cos(ang), sin(ang)) * 20f
        drawLine(c(SKIN), shoulder, hand, strokeWidth = 8f, cap = StrokeCap.Round)
        if (holding) {
            val at = hand + Offset(cos(ang), sin(ang)) * 9f
            translate(at.x, at.y) {
                rotate(deg + 90f, pivot = Offset.Zero) {
                    val v = Path().apply {
                        moveTo(-16f, 6f)
                        quadraticTo(-4f, -10f, 0f, -12f)
                        quadraticTo(4f, -10f, 16f, 6f)
                        lineTo(11f, 8f)
                        quadraticTo(2f, -3f, 0f, -4f)
                        quadraticTo(-2f, -3f, -11f, 8f)
                        close()
                    }
                    drawPath(v, c(WOOD))
                    drawPath(v, c(WOOD_DARK), style = Stroke(1.5f))
                    drawCircle(c(PAINT_RED), 1.6f, Offset(-8f, 1f))
                    drawCircle(c(BEAD), 1.6f, Offset(8f, 1f))
                    drawCircle(c(Color.White), 1.6f, Offset(0f, -8f))
                }
            }
        }
        drawCircle(c(SKIN), 4f, hand)
    }
}
