package com.fightingarena.app.data

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
    val weapon: String = "rifle",
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
data class MatchSummary(
    val id: String,
    val mode: String = "brawl",
    val goals: Int = 0,
    val place: Int,
    val players: Int,
    val kills: Int,
    val deaths: Int,
    val damage: Int,
    val result: String,
    val xpGained: Int,
)

@Serializable
data class MatchPage(val items: List<MatchSummary>, val nextBefore: String? = null)

@Serializable
data class ApiError(val error: String, val message: String)

