package com.fightingarena.app.arena

import kotlinx.serialization.Serializable

// Messages of the /arena WebSocket (see server/src/arena/rooms.ts).

@Serializable
data class MapInfo(val cols: Int, val rows: Int, val tile: Int, val layout: List<String>, val playerRadius: Int) {
    fun tileAt(col: Int, row: Int): Char =
        if (row in 0 until rows && col in 0 until cols) layout[row][col] else '#'
}

@Serializable
data class StartMsg(
    val mode: String = "survival",
    val you: Int,
    val team: Int = 0,
    val brawler: String = "spark",
    val map: MapInfo,
    val durationMs: Long,
    val beaconRadius: Int = 150,
) {
    /** Ball and beacon: blue (0) against red (1). */
    val isTeamMode get() = mode == "ball" || mode == "beacon"
    val isSurvival get() = mode == "survival" || mode == "duo"
}

@Serializable
data class PlayerSnap(
    val id: Int,
    val name: String,
    val b: String = "spark",
    val x: Float,
    val y: Float,
    val f: Float,
    val hp: Int,
    val maxHp: Int,
    val alive: Boolean,
    val c: Int = 0,
    val tm: Int = 0,
    val k: Int = 0,
    val cu: Int = 0,
    val sh: Boolean = false,
    val sl: Boolean = false,
    val inv: Boolean = false,
    val air: Float? = null,
)

@Serializable
data class MeSnap(
    val ammo: Float,
    val sup: Float,
    val respawnIn: Long = 0,
    val out: Boolean = false,
    val follow: Int? = null,
    /** Last numbered move the server applied; null from servers without numbered moves. */
    val ack: Int? = null,
)

@Serializable
data class ShotSnap(
    val id: Int,
    val k: String = "bullet",
    val x: Float,
    val y: Float,
    val o: Int,
    val tm: Int = 0,
    val s: Boolean = false,
    val tx: Float? = null,
    val ty: Float? = null,
    val z: Float? = null,
    val br: Float? = null,
)

@Serializable
data class TurretSnap(val id: Int, val x: Float, val y: Float, val hp: Int, val maxHp: Int, val tm: Int, val o: Int)

@Serializable
data class ZoneSnap(val id: Int, val x: Float, val y: Float, val r: Float, val tm: Int)

@Serializable
data class CubeSnap(val id: Int, val x: Float, val y: Float)

@Serializable
data class EffectSnap(val id: Int, val k: String, val x: Float, val y: Float, val r: Float, val a: Float = 0f, val age: Long = 0)

@Serializable
data class BallSnap(val x: Float, val y: Float, val h: Int? = null, val r: Float)

@Serializable
data class BeaconSnap(val p: List<Float>, val s: Int)

@Serializable
data class GoalEvent(val team: Int, val scorer: String, val time: Long)

@Serializable
data class KillEvent(val time: Long, val killer: String, val victim: String)

@Serializable
data class StateMsg(
    val time: Long,
    val left: Long,
    val me: MeSnap? = null,
    val players: List<PlayerSnap>,
    val shots: List<ShotSnap> = emptyList(),
    val turrets: List<TurretSnap> = emptyList(),
    val zones: List<ZoneSnap> = emptyList(),
    val cubes: List<CubeSnap> = emptyList(),
    /** Unbroken boxes as [tile index, hp]; null outside survival modes. */
    val boxes: List<List<Int>>? = null,
    val fx: List<EffectSnap> = emptyList(),
    val gas: Float? = null,
    val teamsLeft: Int? = null,
    val feed: List<KillEvent> = emptyList(),
    val ball: BallSnap? = null,
    val score: List<Int>? = null,
    val beacon: BeaconSnap? = null,
    val pause: Long = 0,
    val goal: GoalEvent? = null,
)

@Serializable
data class ResultRow(
    val name: String,
    val brawler: String = "spark",
    val place: Int,
    val team: Int = 0,
    val kills: Int,
    val deaths: Int,
    val goals: Int = 0,
    val cubes: Int = 0,
    val you: Boolean,
)

@Serializable
data class EndMsg(
    val mode: String = "survival",
    val brawler: String? = null,
    val place: Int? = null,
    val result: String? = null,
    val team: Int? = null,
    val score: List<Int>? = null,
    val beacon: List<Int>? = null,
    val xpGained: Int = 0,
    val results: List<ResultRow>,
)
