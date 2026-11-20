package com.fightingarena.app.ui

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.PI
import kotlin.math.floor

private const val HAMMER_FRAME = 64
private const val HAMMER_DIRECTIONS = 8
internal const val HAMMER_ATTACK_NANOS = 600_000_000L

/** Directional sprite atlases rendered from the bear-warrior GLB model. */
class HammerSprites(
    val idle: ImageBitmap,
    val run: ImageBitmap,
    val attack: ImageBitmap,
    val jump: ImageBitmap,
)

@Composable
fun rememberHammerSprites(): HammerSprites {
    val context = LocalContext.current
    return remember(context) {
        HammerSprites(
            idle = context.loadHammerSprite("hammer_idle.webp.b64"),
            run = context.loadHammerSprite("hammer_run.webp.b64"),
            attack = context.loadHammerSprite("hammer_attack.webp.b64"),
            jump = context.loadHammerSprite("hammer_jump.webp.b64"),
        )
    }
}

/* Text containers and numbered parts travel safely through text-only repository tools. */
private fun Context.loadHammerSprite(name: String): ImageBitmap {
    val parts = assets.list("")
        ?.filter { it.startsWith("$name.part") }
        ?.sorted()
        .orEmpty()
    val encoded = if (parts.isEmpty()) {
        assets.open(name).bufferedReader().use { it.readText() }
    } else {
        parts.joinToString("") { part ->
            assets.open(part).bufferedReader().use { it.readText() }
        }
    }
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    return requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size)) {
        "Не удалось декодировать спрайт $name"
    }.asImageBitmap()
}

/** Row zero looks down the screen; subsequent rows turn clockwise in screen space. */
private fun hammerDirection(facing: Float): Int {
    val tau = 2f * PI.toFloat()
    val fromDown = (PI.toFloat() / 2f - facing).mod(tau)
    return floor(fromDown / tau * HAMMER_DIRECTIONS + 0.5f)
        .toInt()
        .mod(HAMMER_DIRECTIONS)
}

fun DrawScope.drawHammerSprite(
    pos: Offset,
    sprites: HammerSprites,
    walk: WalkState,
    facing: Float,
    side: Color,
    alpha: Float,
    swing: Float?,
    air: Float?,
    nowNanos: Long,
    spriteSize: Float = 112f,
    drawGround: Boolean = true,
) {
    if (drawGround) {
        fun c(color: Color) = color.copy(alpha = color.alpha * alpha)
        drawOval(
            c(Color.Black.copy(alpha = 0.25f)),
            pos + Offset(-26f, 12f),
            Size(52f, 20f),
        )
        drawOval(
            c(side),
            pos + Offset(-28f, 10f),
            Size(56f, 24f),
            style = Stroke(4f),
        )
    }

    val row = hammerDirection(facing)
    val animation = when {
        air != null -> Triple(sprites.jump, 4, air.coerceIn(0f, 0.999f))
        swing != null -> Triple(sprites.attack, 6, swing.coerceIn(0f, 0.999f))
        walk.moving > 0.25f -> Triple(
            sprites.run,
            4,
            (walk.phase / (2f * PI.toFloat())).mod(1f),
        )
        else -> Triple(
            sprites.idle,
            2,
            ((nowNanos / 400_000_000L).mod(2L)).toFloat() / 2f,
        )
    }

    val (atlas, frames, progress) = animation
    val frame = (progress * frames).toInt().coerceIn(0, frames - 1)
    drawImage(
        image = atlas,
        srcOffset = IntOffset(frame * HAMMER_FRAME, row * HAMMER_FRAME),
        srcSize = IntSize(HAMMER_FRAME, HAMMER_FRAME),
        dstOffset = IntOffset(
            (pos.x - spriteSize / 2f).toInt(),
            (pos.y - spriteSize * 0.75f).toInt(),
        ),
        dstSize = IntSize(spriteSize.toInt(), spriteSize.toInt()),
        alpha = alpha,
    )
}
