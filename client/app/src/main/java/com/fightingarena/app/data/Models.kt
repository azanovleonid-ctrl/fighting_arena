package com.fightingarena.app.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors the server's JSON (see server/src). Unknown fields are ignored by the decoder.

@Serializable
data class Credentials(val username: String, val password: String)

@Serializable
data class AuthResponse(val token: String, val user: Profile)

@Serializable
data class Stats(val strength: Int, val agility: Int, val intuition: Int, val endurance: Int)

@Serializable
data class StatPoints(
    val strength: Int = 0,
    val agility: Int = 0,
    val intuition: Int = 0,
    val endurance: Int = 0,
)

@Serializable
data class Record(val wins: Int, val losses: Int, val draws: Int)

@Serializable
data class Settings(
    val language: String = "ru",
    val theme: String = "dark",
    val sound: Boolean = true,
    val vibration: Boolean = true,
)

@Serializable
data class Profile(
    val id: String,
    val username: String,
    val level: Int,
    val xp: Int,
    val xpToNextLevel: Int,
    val freePoints: Int,
    val stats: Stats,
    val maxHp: Int,
    val record: Record,
    val settings: Settings,
)

@Serializable
enum class Zone(val title: String) {
    @SerialName("head") HEAD("Голова"),
    @SerialName("chest") CHEST("Грудь"),
    @SerialName("belly") BELLY("Живот"),
    @SerialName("waist") WAIST("Пояс"),
    @SerialName("legs") LEGS("Ноги"),
}

@Serializable
data class Move(val attack: Zone, val blocks: List<Zone>)

@Serializable
data class Strike(val attacker: String, val zone: Zone, val outcome: String, val damage: Int)

@Serializable
data class Round(
    val number: Int,
    val playerMove: Move,
    val opponentMove: Move,
    val strikes: List<Strike>,
    val playerHp: Int,
    val opponentHp: Int,
)

@Serializable
data class FighterView(val name: String, val hp: Int, val maxHp: Int, val stats: Stats)

@Serializable
data class Fight(
    val id: String,
    val status: String,
    val result: String? = null,
    val player: FighterView,
    val opponent: FighterView,
    val rounds: List<Round>,
    val xpGained: Int,
) {
    val isActive get() = status == "active"
}

@Serializable
data class FightSummary(
    val id: String,
    val opponent: String,
    val result: String? = null,
    val rounds: Int,
    val xpGained: Int,
    val finishedAt: String? = null,
)

@Serializable
data class FightPage(val items: List<FightSummary>, val nextBefore: String? = null)

@Serializable
data class ApiError(val error: String, val message: String)

fun resultTitle(result: String?) = when (result) {
    "win" -> "Победа"
    "loss" -> "Поражение"
    "draw" -> "Ничья"
    else -> "Бой идёт"
}
