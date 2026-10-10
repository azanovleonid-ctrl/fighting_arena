package com.fightingarena.app.data

import androidx.compose.ui.graphics.Color

/** How a brawler's attack or super is aimed, for the guide drawn on the ground. */
enum class AimShape { LINE, FAN, ARC, THROW, DASH, SELF }

/** Brawlers as in docs/design.md (the server holds the real numbers; these are for display). */
data class BrawlerInfo(
    val id: String,
    val name: String,
    val role: String,
    val hp: Int,
    val speed: Int,
    val range: Int,
    val damage: String,
    val attack: String,
    val superName: String,
    val color: Color,
    val aim: AimShape,
    val superAim: AimShape,
    val superRange: Int,
)

val BRAWLERS = listOf(
    BrawlerInfo("hammer", "Кувалда", "Танк", 6000, 245, 150, "1500", "Удар молотом по дуге перед собой", "Прыжок с ударом при приземлении", Color(0xFF8D6E63), AimShape.ARC, AimShape.THROW, 520),
    BrawlerInfo("spark", "Искра", "Ближний бой", 4600, 235, 330, "5 × 330", "Дробовик: веер из 5 дробинок", "Рывок сквозь врагов", Color(0xFFFF7043), AimShape.FAN, AimShape.DASH, 405),
    BrawlerInfo("boomer", "Бумер", "Боец", 3900, 240, 520, "600 + 600", "Бумеранг: бьёт туда и обратно", "Три бумеранга веером", Color(0xFF66BB6A), AimShape.LINE, AimShape.FAN, 560),
    BrawlerInfo("tinker", "Винтик", "Инженер", 3600, 235, 520, "2 × 360", "Два болта параллельно", "Турель, которая стреляет сама", Color(0xFFFFCA28), AimShape.LINE, AimShape.SELF, 70),
    BrawlerInfo("shade", "Тень", "Убийца", 3500, 265, 210, "2 × 520", "Два быстрых кинжала", "Невидимость и скорость", Color(0xFF7E57C2), AimShape.FAN, AimShape.SELF, 0),
    BrawlerInfo("thunder", "Гром", "Метатель", 3400, 225, 470, "1150", "Бомба через стены", "Ковёр из 5 бомб", Color(0xFFEF5350), AimShape.THROW, AimShape.THROW, 470),
    BrawlerInfo("blizzard", "Вьюга", "Контроль", 3400, 235, 560, "900", "Ледяной осколок замедляет", "Метель: зона урона и замедления", Color(0xFF4FC3F7), AimShape.LINE, AimShape.THROW, 560),
    BrawlerInfo("arrow", "Стрела", "Снайпер", 3200, 240, 620, "3 × 380", "Очередь из 3 пуль", "Пробивающий залп из 9 пуль", Color(0xFFEC407A), AimShape.LINE, AimShape.FAN, 720),
)

fun brawler(id: String?): BrawlerInfo = BRAWLERS.find { it.id == id } ?: BRAWLERS[1]

data class ModeInfo(val id: String, val name: String, val about: String)

val MODES = listOf(
    ModeInfo("survival", "Выживание", "6 бойцов, каждый сам за себя. Газ сужает арену"),
    ModeInfo("duo", "Парное выживание", "3 пары. Напарник возвращает тебя в бой"),
    ModeInfo("ball", "Мяч", "3 на 3. Два гола — победа"),
    ModeInfo("beacon", "Маяк", "3 на 3. Удерживай круг в центре"),
)

/** Name for a mode, including the old ones still in match history. */
fun modeName(id: String?): String = MODES.find { it.id == id }?.name ?: when (id) {
    "football" -> "Футбол"
    else -> "Схватка"
}
