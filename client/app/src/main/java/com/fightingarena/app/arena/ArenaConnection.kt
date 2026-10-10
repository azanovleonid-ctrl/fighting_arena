package com.fightingarena.app.arena

import com.fightingarena.app.BuildConfig
import com.fightingarena.app.data.json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

sealed interface Phase {
    data object Connecting : Phase
    data object Queued : Phase
    data class Playing(val start: StartMsg) : Phase
    data class Ended(val end: EndMsg) : Phase
    data class Failed(val message: String) : Phase
}

/**
 * One arena session. Snapshots are kept in plain fields, not Compose state, because the
 * render loop reads them every frame and they arrive ~30 times a second.
 */
class ArenaConnection(token: String, private val mode: String, private val weapon: String) {
    private val _phase = MutableStateFlow<Phase>(Phase.Connecting)
    val phase: StateFlow<Phase> = _phase

    @Volatile var previous: StateMsg? = null
        private set
    @Volatile var current: StateMsg? = null
        private set
    @Volatile var currentAtNanos: Long = 0
        private set

    private val socket: WebSocket

    init {
        val url = BuildConfig.API_BASE_URL.replaceFirst("http", "ws") +
            "arena?token=" + URLEncoder.encode(token, "UTF-8")
        socket = client.newWebSocket(Request.Builder().url(url).build(), Listener())
    }

    fun playAgain() {
        previous = null
        current = null
        _phase.value = Phase.Queued
        send("""{"t":"play","mode":"$mode","weapon":"$weapon"}""")
    }

    fun move(x: Float, y: Float) = send("""{"t":"move","mx":$x,"my":$y}""")
    fun fire(ax: Float, ay: Float) = send("""{"t":"fire","ax":$ax,"ay":$ay}""")
    fun superAttack(ax: Float, ay: Float) = send("""{"t":"super","ax":$ax,"ay":$ay}""")

    fun close() {
        socket.close(1000, null)
    }

    private fun send(text: String) {
        socket.send(text)
    }

    private inner class Listener : WebSocketListener() {
        override fun onMessage(webSocket: WebSocket, text: String) {
            val obj = runCatching { json.parseToJsonElement(text) as JsonObject }.getOrNull() ?: return
            when (obj["t"]?.jsonPrimitive?.content) {
                "hello" -> playAgain()
                "queued" -> _phase.value = Phase.Queued
                "start" -> _phase.value = Phase.Playing(json.decodeFromJsonElement(StartMsg.serializer(), obj))
                "state" -> {
                    previous = current
                    current = json.decodeFromJsonElement(StateMsg.serializer(), obj)
                    currentAtNanos = System.nanoTime()
                }
                "end" -> _phase.value = Phase.Ended(json.decodeFromJsonElement(EndMsg.serializer(), obj))
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (code == 4401) _phase.value = Phase.Failed("Нужно заново войти в аккаунт")
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (_phase.value !is Phase.Ended) _phase.value = Phase.Failed("Нет связи с сервером")
        }
    }

    companion object {
        private val client = OkHttpClient.Builder().pingInterval(15, TimeUnit.SECONDS).build()
    }
}
