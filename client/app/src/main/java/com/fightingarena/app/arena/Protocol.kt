package com.fightingarena.app.arena

import kotlinx.serialization.Serializable

// Messages of the /arena WebSocket (see server/src/arena/rooms.ts).

@Serializable
data class MapInfo(val cols: Int, val rows: Int, val tile: Int, val layout: List<String>, val playerRadius: Int) {
    fun tileAt(col: Int, row: Int): Char =
        if (row in 0 until rows && col in 0 until cols) layout[row][col] else '#'
}

@Serializable
data class StartMsg(val you: Int, val map: MapInfo, val durationMs: Long)

@Serializable
data class PlayerSnap(
    val id: Int,
    val name: String,
    val x: Float,
    val y: Float,
    val f: Float,
    val hp: Int,
    val maxHp: Int,
    val alive: Boolean,
    val c: Int,
    val k: Int,
)

@Serializable
data class MeSnap(val ammo: Float, val sup: Float, val respawnIn: Long)

@Serializable
data class BulletSnap(val id: Int, val x: Float, val y: Float, val o: Int, val s: Boolean)

@Serializable
data class KillEvent(val time: Long, val killer: String, val victim: String)

@Serializable
data class StateMsg(
    val time: Long,
    val left: Long,
    val me: MeSnap? = null,
    val players: List<PlayerSnap>,
    val bullets: List<BulletSnap>,
    val feed: List<KillEvent> = emptyList(),
)

@Serializable
data class ResultRow(val name: String, val place: Int, val kills: Int, val deaths: Int, val you: Boolean)

@Serializable
data class EndMsg(val place: Int? = null, val xpGained: Int = 0, val results: List<ResultRow>)
