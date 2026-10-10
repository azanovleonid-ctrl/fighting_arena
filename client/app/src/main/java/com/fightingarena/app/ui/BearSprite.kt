package com.fightingarena.app.ui

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sin

private val FUR = Color(0xFF8D5A3B)
private val FUR_DARK = Color(0xFF6B4029)
private val FUR_LIGHT = Color(0xFFD7A97A)
private val NOSE = Color(0xFF2B1B12)
private val HANDLE = Color(0xFF5D4037)
private val STEEL = Color(0xFF90A4AE)
private val STEEL_DARK = Color(0xFF546E7A)

/** Walking state of one player, kept between frames so the legs step with the distance covered. */
class WalkState(var x: Float, var y: Float) {
    var phase = 0f
    var moving = 0f
    var facingRight = true
}

/** Updates the walk cycle from the new position: about one full step every 70 units. */
fun WalkState.advance(pos: Offset, facing: Float) {
    val d = hypot(pos.x - x, pos.y - y)
    if (d < 40f) phase += d * (2f * PI.toFloat() / 70f)
    moving = moving * 0.8f + (if (d > 0.3f) 1f else 0f) * 0.2f
    x = pos.x
    y = pos.y
    val c = cos(facing)
    if (abs(c) > 0.15f) facingRight = c > 0f
}

/**
 * A bear standing on its hind legs with a war hammer, seen from slightly above.
 * [pos] is the centre of the player's circle; [swing] runs 0..1 during a hammer blow.
 */
fun DrawScope.drawBear(pos: Offset, walk: WalkState, side: Color, alpha: Float, swing: Float) {
    val m = walk.moving
    val s = sin(walk.phase)
    val bob = abs(cos(walk.phase)) * 3f * m
    fun c(color: Color) = color.copy(alpha = color.alpha * alpha)

    // Shadow and the team ring at the feet stay flat on the floor.
    drawOval(c(Color.Black.copy(alpha = 0.25f)), pos + Offset(-26f, 12f), Size(52f, 20f))
    drawOval(c(side), pos + Offset(-28f, 10f), Size(56f, 24f), style = Stroke(4f))

    withTransform({
        translate(pos.x, pos.y)
        scale(if (walk.facingRight) 1f else -1f, 1f, pivot = Offset.Zero)
    }) {
        val body = Offset(0f, -14f - bob)

        // Legs swing in opposite directions and the stepping foot lifts a little.
        fun leg(hipX: Float, swingX: Float, lift: Float, color: Color) {
            val top = Offset(hipX - 7f + swingX * 0.4f, body.y + 14f)
            drawRoundRect(c(color), top, Size(14f, 22f - lift), CornerRadius(6f))
            drawOval(c(FUR_DARK), Offset(hipX - 9f + swingX, body.y + 31f - lift), Size(18f, 9f))
        }
        leg(-8f, -s * 7f * m, max(0f, -s) * 6f * m, FUR_DARK)

        // Back arm.
        drawRoundRect(c(FUR_DARK), body + Offset(-22f, -10f + s * 3f * m), Size(12f, 24f), CornerRadius(6f))

        // Body with a light belly.
        drawOval(c(FUR), body - Offset(19f, 22f), Size(38f, 44f))
        drawOval(c(FUR_LIGHT), body - Offset(11f, 12f), Size(22f, 28f))

        leg(8f, s * 7f * m, max(0f, s) * 6f * m, FUR)

        // Head: ears, face, muzzle, nose and an eye looking forward.
        val head = body + Offset(4f, -30f)
        drawCircle(c(FUR), 7f, head + Offset(-11f, -12f))
        drawCircle(c(FUR), 7f, head + Offset(9f, -14f))
        drawCircle(c(FUR_LIGHT), 3.5f, head + Offset(-11f, -12f))
        drawCircle(c(FUR_LIGHT), 3.5f, head + Offset(9f, -14f))
        drawCircle(c(FUR), 16f, head)
        drawOval(c(FUR_LIGHT), head + Offset(4f, -2f), Size(16f, 12f))
        drawCircle(c(NOSE), 3.5f, head + Offset(18f, 2f))
        drawCircle(c(NOSE), 2.6f, head + Offset(6f, -6f))
        drawLine(c(NOSE), head + Offset(-2f, -11f), head + Offset(10f, -10f), strokeWidth = 2.5f)

        // Hammer rests over the shoulder and comes down forward during a blow.
        val k = swing.coerceIn(0f, 1f)
        val strike = if (k < 0.3f) k / 0.3f else 1f - (k - 0.3f) / 0.7f
        val hand = body + Offset(14f, -4f)
        val angle = -150f + 185f * strike
        rotate(angle, pivot = hand) {
            drawRoundRect(c(HANDLE), hand + Offset(-6f, -3f), Size(42f, 6f), CornerRadius(3f))
            drawRoundRect(c(STEEL), hand + Offset(30f, -13f), Size(16f, 26f), CornerRadius(3f))
            drawRoundRect(c(STEEL_DARK), hand + Offset(30f, -13f), Size(16f, 26f), CornerRadius(3f), style = Stroke(2f))
        }
        // Front paw grips the handle.
        drawRoundRect(c(FUR), body + Offset(4f, -10f - s * 3f * m), Size(14f, 12f), CornerRadius(6f))
        drawCircle(c(FUR_DARK), 6.5f, hand)
    }
}
