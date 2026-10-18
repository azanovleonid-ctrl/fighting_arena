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

private val CLOAK = Color(0xFF26262F)
private val CLOAK_DARK = Color(0xFF15151C)
private val CLOAK_EDGE = Color(0xFF3A3A48)
private val HOOD_IN = Color(0xFF07070A)
private val EYE = Color(0xFFB388FF)
private val EYE_CORE = Color(0xFFEDE7F6)
private val SASH = Color(0xFF7E57C2)
private val SASH_DARK = Color(0xFF5E35B1)
private val GLOVE = Color(0xFF2E2E3A)
private val BOOT = Color(0xFF101015)
private val BLADE = Color(0xFFCFD8DC)
private val HILT = Color(0xFF4A3B6B)
private const val PI_F = PI.toFloat()

/**
 * Тень as a hooded assassin in black: glowing eyes under the hood, a cloak that flutters on the
 * run, a dagger forward in the front hand and a second one blade-down in the back hand.
 * [stab] runs from 1 down to 0 right after a throw.
 */
fun DrawScope.drawShade(pos: Offset, walk: WalkState, side: Color, alpha: Float, stab: Float, timeS: Float) {
    val m = walk.moving
    val s = sin(walk.phase)
    val bob = abs(cos(walk.phase)) * 3f * m
    val wave = sin(timeS * 5f) * 0.08f
    fun c(color: Color) = color.copy(alpha = color.alpha * alpha)

    drawCircle(
        Brush.radialGradient(listOf(Color(0x4D311B92), Color(0x00311B92)), center = pos + Offset(0f, -18f), radius = 44f),
        radius = 44f,
        center = pos + Offset(0f, -18f),
        alpha = alpha,
    )
    drawOval(c(Color.Black.copy(alpha = 0.25f)), pos + Offset(-24f, 12f), Size(48f, 18f))
    drawOval(c(side), pos + Offset(-28f, 10f), Size(56f, 24f), style = Stroke(4f))

    withTransform({
        translate(pos.x, pos.y)
        scale(if (walk.facingRight) 1f else -1f, 1f, pivot = Offset.Zero)
    }) {
        val by = -16f - bob

        fun line(a: Offset, b: Offset, width: Float, color: Color) =
            drawLine(c(color), a, b, strokeWidth = width, cap = StrokeCap.Round)

        fun shape(color: Color, pts: List<Offset>) {
            val path = Path().apply {
                moveTo(pts[0].x, pts[0].y)
                for (p in pts.drop(1)) lineTo(p.x, p.y)
                close()
            }
            drawPath(path, c(color))
        }

        fun leg(hipX: Float, swingX: Float, lift: Float, color: Color) {
            val knee = Offset(hipX + swingX * 0.5f, by + 25f - lift * 0.5f)
            val foot = Offset(hipX + swingX, by + 33f - lift)
            line(Offset(hipX, by + 12f), knee, 7f, color)
            line(knee, foot, 6f, color)
            drawRoundRect(c(BOOT), foot + Offset(-4f, -3f), Size(12f, 6f), CornerRadius(3f))
        }

        // A dagger held at (hand) with the blade pointing along angle a, l long.
        fun dagger(hand: Offset, a: Float, l: Float) {
            val d = Offset(cos(a), sin(a))
            val n = Offset(-d.y, d.x)
            line(hand - d * 5f, hand + d * 3f, 3.5f, HILT)
            line(hand + d * 3f + n * 5f, hand + d * 3f - n * 5f, 3f, HILT)
            shape(BLADE, listOf(hand + d * 4f + n * 3f, hand + d * l, hand + d * 4f - n * 3f))
            line(hand + d * 6f + n, hand + d * (l - 4f), 1.2f, Color.White)
        }

        // Cloak tail flutters behind, longer while running.
        val flap = 6f + 8f * m
        shape(
            CLOAK_DARK,
            listOf(
                Offset(-8f, by - 16f),
                Offset(-14f - flap, by + 4f + wave * 30f),
                Offset(-18f - flap, by + 22f + wave * 20f),
                Offset(-10f - flap * 0.5f, by + 18f),
                Offset(-6f - flap * 0.4f, by + 26f),
                Offset(2f, by + 16f),
            ),
        )

        leg(-4f, -s * 8f * m, max(0f, -s) * 6f * m, CLOAK_DARK)
        val backHand = Offset(-11f - s * 3f * m, by + 4f)
        line(Offset(-6f, by - 12f), backHand, 7f, CLOAK_DARK)
        dagger(backHand, PI_F * 0.62f, 16f)
        drawCircle(c(GLOVE), 3.8f, backHand)

        // Torso in a dark coat with a violet sash.
        drawRoundRect(c(CLOAK), Offset(-11f, by - 18f), Size(22f, 32f), CornerRadius(9f))
        shape(SASH, listOf(Offset(-11f, by + 1f), Offset(11f, by - 3f), Offset(11f, by + 3f), Offset(-11f, by + 7f)))
        shape(SASH_DARK, listOf(Offset(-9f, by + 4f), Offset(-15f - wave * 20f, by + 15f), Offset(-12f - wave * 20f, by + 17f), Offset(-5f, by + 6f)))
        leg(4f, s * 8f * m, max(0f, s) * 6f * m, CLOAK)

        // Hood peaks at the back; the face stays in deep shadow with two glowing eyes and a mask.
        val h = Offset(3f, by - 29f)
        drawPath(
            Path().apply {
                moveTo(h.x - 15f, h.y + 12f)
                quadraticTo(h.x - 18f, h.y - 2f, h.x - 13f, h.y - 21f)
                quadraticTo(h.x + 2f, h.y - 19f, h.x + 10f, h.y - 11f)
                quadraticTo(h.x + 16f, h.y - 2f, h.x + 14f, h.y + 12f)
                close()
            },
            c(CLOAK),
        )
        drawOval(c(CLOAK_EDGE), h + Offset(-4f, -10f), Size(19f, 21f))
        drawOval(c(HOOD_IN), h + Offset(-2f, -8f), Size(16f, 18f))
        val eyes = h + Offset(8f, -1f)
        drawCircle(
            Brush.radialGradient(listOf(Color(0x8CB388FF), Color(0x00B388FF)), center = eyes, radius = 12f),
            radius = 12f,
            center = eyes,
            alpha = alpha,
        )
        for (x in listOf(3f, 10f)) {
            drawOval(c(EYE), h + Offset(x, -3f), Size(5f, 3.4f))
            drawOval(c(EYE_CORE), h + Offset(x + 1.5f, -2.4f), Size(2f, 1.6f))
        }
        drawRoundRect(c(CLOAK_EDGE), h + Offset(-1f, 3f), Size(15f, 7f), CornerRadius(3f))

        // Front arm thrusts the dagger forward right after a throw.
        val k = stab.coerceIn(0f, 1f)
        val hand = Offset(12f + k * 9f, by - 4f - k * 2f)
        line(Offset(3f, by - 12f), hand, 7f, CLOAK)
        dagger(hand, -0.12f * (1f - k), 22f)
        drawCircle(c(GLOVE), 4.2f, hand)
        if (k > 0.3f) {
            val trail = EYE.copy(alpha = 0.75f * k)
            line(hand + Offset(24f, -5f), hand + Offset(44f, -3f), 3f, trail)
            line(hand + Offset(24f, 4f), hand + Offset(44f, 4f), 3f, trail)
        }
    }
}
