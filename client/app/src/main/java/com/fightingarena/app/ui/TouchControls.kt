package com.fightingarena.app.ui

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerId
import androidx.compose.ui.input.pointer.PointerInputScope
import androidx.compose.ui.input.pointer.changedToDown
import androidx.compose.ui.input.pointer.changedToUp
import androidx.compose.ui.unit.IntSize
import com.fightingarena.app.arena.ArenaConnection

class Stick(val pointer: PointerId, val origin: Offset) {
    var pos by mutableStateOf(origin)
}

/**
 * Twin-stick controls: a finger on the left half moves. A finger on the right half fires the
 * moment it touches (at the nearest enemy), and while it is held and dragged it keeps firing
 * where it points as fast as ammo allows. The super button: tap for the nearest enemy, drag to aim.
 */
class TouchControls(val stickRadius: Float, val superRadius: Float) {
    var move by mutableStateOf<Stick?>(null)
    var aim by mutableStateOf<Stick?>(null)
    var superStick by mutableStateOf<Stick?>(null)
    /** Tries to fire with an aim vector (zero = nearest enemy); true when a shot went out. */
    var trigger: ((Offset) -> Boolean)? = null
    /** Called when the aim finger is lifted, with where it pointed (used to kick the ball). */
    var onRelease: ((Offset) -> Unit)? = null
    private var sentMove = Offset.Zero
    private var lastSentAt = 0L

    fun superCenter(size: IntSize) = Offset(size.width - superRadius * 2.2f, size.height - superRadius * 5.5f)

    fun moveVector(): Offset = move?.let { normalized(it.pos - it.origin) } ?: Offset.Zero

    /** Aim vector (length 0–1 = how far), or zero while the finger is inside the dead zone (tap = auto-aim). */
    fun aimVector(): Offset = vectorOf(aim)

    fun superVector(): Offset = vectorOf(superStick)

    private fun vectorOf(stick: Stick?): Offset =
        stick?.let { normalized(it.pos - it.origin) }?.takeIf { it.getDistance() > 0.2f } ?: Offset.Zero

    private fun normalized(d: Offset): Offset {
        val len = d.getDistance()
        if (len < 1f) return Offset.Zero
        val k = minOf(len, stickRadius) / stickRadius / len
        return Offset(d.x * k, d.y * k)
    }

    /** While the aim finger is dragged, keeps firing where it points. */
    fun holdFire() {
        val v = aimVector()
        if (aim != null && v != Offset.Zero) trigger?.invoke(v)
    }

    /** Sends the movement vector when it changed noticeably, at most every 40 ms. */
    fun flushMove(conn: ArenaConnection, nowNanos: Long) {
        val v = moveVector()
        val changed = (v - sentMove).getDistance() > 0.08f || (v == Offset.Zero && sentMove != Offset.Zero)
        if (changed && nowNanos - lastSentAt > 40_000_000) {
            conn.move(v.x, v.y)
            sentMove = v
            lastSentAt = nowNanos
        }
    }

    fun onDown(id: PointerId, at: Offset, size: IntSize, conn: ArenaConnection) {
        when {
            (at - superCenter(size)).getDistance() <= superRadius * 1.3f -> if (superStick == null) superStick = Stick(id, at)
            at.x < size.width / 2f -> if (move == null) move = Stick(id, at)
            else -> if (aim == null) {
                aim = Stick(id, at)
                trigger?.invoke(Offset.Zero)
            }
        }
    }

    fun onDrag(id: PointerId, at: Offset) {
        move?.takeIf { it.pointer == id }?.pos = at
        aim?.takeIf { it.pointer == id }?.pos = at
        superStick?.takeIf { it.pointer == id }?.pos = at
    }

    fun onUp(id: PointerId, conn: ArenaConnection) {
        if (move?.pointer == id) move = null
        if (aim?.pointer == id) {
            onRelease?.invoke(aimVector())
            aim = null
        }
        if (superStick?.pointer == id) {
            val v = superVector()
            conn.superAttack(v.x, v.y)
            superStick = null
        }
    }
}

suspend fun PointerInputScope.handleTouches(controls: TouchControls, conn: ArenaConnection) {
    awaitPointerEventScope {
        while (true) {
            val event = awaitPointerEvent()
            for (change in event.changes) {
                when {
                    change.changedToDown() -> controls.onDown(change.id, change.position, size, conn)
                    change.changedToUp() -> controls.onUp(change.id, conn)
                    change.pressed -> controls.onDrag(change.id, change.position)
                }
                change.consume()
            }
        }
    }
}
