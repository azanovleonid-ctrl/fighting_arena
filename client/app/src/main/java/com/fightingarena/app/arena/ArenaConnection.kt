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

class Frame(val a: StateMsg, val b: StateMsg, val t: Float)

sealed interface Phase {
    data object Connecting : Phase
    data object Queued : Phase
    data class Playing(val start: StartMsg) : Phase
    data class Ended(val end: EndMsg) : Phase
    data class Failed(val message: String) : Phase
    /** Waiting in a private room for a friend to join with [code]. */
    data class Party(val code: String, val together: Boolean) : Phase
}

/** Playing with a friend: open a room and get a code, or join one by its code. */
sealed interface PartyRequest {
    data class Create(val together: Boolean) : PartyRequest
    data class Join(val code: String) : PartyRequest
}

/**
 * One arena session. Snapshots are kept in plain fields, not Compose state, because the
 * render loop reads them every frame and they arrive ~30 times a second.
 */
class ArenaConnection(
    token: String,
    private val mode: String,
    private val brawler: String,
    val party: PartyRequest? = null,
) {
    private val _phase = MutableStateFlow<Phase>(Phase.Connecting)
    val phase: StateFlow<Phase> = _phase

    /** The newest snapshot, for the HUD (ammo, super) and own-brawler prediction. */
    @Volatile var latest: StateMsg? = null
        private set

    // Recent snapshots. Others are drawn ~100 ms in the past, between two snapshots, so uneven
    // network delivery does not show up as stutter.
    private val buffer = ArrayDeque<StateMsg>()
    private var offsetMs = Double.NaN // local clock minus match clock, tracking the fastest deliveries

    private val socket: WebSocket

    init {
        val url = BuildConfig.API_BASE_URL.replaceFirst("http", "ws") +
            "arena?token=" + URLEncoder.encode(token, "UTF-8")
        socket = client.newWebSocket(Request.Builder().url(url).build(), Listener())
    }

    /** Two snapshots around the render time and how far between them (0–1). */
    fun frame(nowNanos: Long): Frame? = synchronized(buffer) { pick(nowNanos) }

    private fun pick(nowNanos: Long): Frame? {
        if (buffer.isEmpty() || offsetMs.isNaN()) return null
        val renderAt = nowNanos / 1e6 - offsetMs - RENDER_DELAY_MS
        val first = buffer.first()
        val last = buffer.last()
        if (renderAt <= first.time) return Frame(first, first, 0f)
        if (renderAt >= last.time) return Frame(last, last, 0f)
        for (i in 0 until buffer.size - 1) {
            val a = buffer[i]
            val b = buffer[i + 1]
            if (renderAt < b.time) {
                val span = (b.time - a.time).coerceAtLeast(1L)
                return Frame(a, b, ((renderAt - a.time) / span).toFloat().coerceIn(0f, 1f))
            }
        }
        return Frame(last, last, 0f)
    }

    private fun receive(state: StateMsg) {
        synchronized(buffer) {
            // A new match restarts the match clock.
            if (buffer.isNotEmpty() && state.time < buffer.last().time) {
                buffer.clear()
                offsetMs = Double.NaN
            }
            buffer.addLast(state)
            while (buffer.size > 40) buffer.removeFirst()
            val sample = System.nanoTime() / 1e6 - state.time
            // Follow faster deliveries at once and slower ones gently (the server clock drifts a little).
            offsetMs = if (offsetMs.isNaN() || sample < offsetMs) sample else offsetMs + (sample - offsetMs) * 0.02
        }
        latest = state
    }

    fun playAgain() {
        latest = null
        synchronized(buffer) {
            buffer.clear()
            offsetMs = Double.NaN
        }
        _phase.value = Phase.Queued
        send("""{"t":"play","mode":"$mode","brawler":"$brawler"}""")
    }

    /** Round trip to the server in ms, measured with ping messages; null until the first answer. */
    @Volatile var pingMs: Int? = null
        private set
    /** Best of the last 10 pings: the network's own delay without spikes. */
    @Volatile var pingMinMs: Int? = null
        private set
    private val recentPings = ArrayDeque<Int>()
    private var lastPingNanos = 0L

    /** Sends a ping about once a second (called from the frame loop). */
    fun maybePing(nowNanos: Long) {
        if (nowNanos - lastPingNanos < 1_000_000_000L) return
        lastPingNanos = nowNanos
        send("""{"t":"ping","c":${System.nanoTime()}}""")
    }

    fun move(x: Float, y: Float) = send("""{"t":"move","mx":$x,"my":$y}""")
    fun move(x: Float, y: Float, seq: Int) = send("""{"t":"move","mx":$x,"my":$y,"s":$seq}""")
    fun fire(ax: Float, ay: Float) = send("""{"t":"fire","ax":$ax,"ay":$ay}""")
    fun superAttack(ax: Float, ay: Float) = send("""{"t":"super","ax":$ax,"ay":$ay}""")

    private fun openParty(request: PartyRequest) {
        when (request) {
            is PartyRequest.Create ->
                send("""{"t":"party_create","mode":"$mode","brawler":"$brawler","together":${request.together}}""")
            is PartyRequest.Join ->
                send("""{"t":"party_join","code":"${request.code.filter { it.isDigit() }}","brawler":"$brawler"}""")
        }
    }

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
                "hello" -> if (party == null) playAgain() else openParty(party)
                "party" -> _phase.value = Phase.Party(
                    obj["code"]?.jsonPrimitive?.content.orEmpty(),
                    obj["together"]?.jsonPrimitive?.content == "true",
                )
                "party_error" -> _phase.value = Phase.Failed(obj["message"]?.jsonPrimitive?.content ?: "Не получилось")
                "queued" -> _phase.value = Phase.Queued
                "start" -> _phase.value = Phase.Playing(json.decodeFromJsonElement(StartMsg.serializer(), obj))
                "state" -> receive(json.decodeFromJsonElement(StateMsg.serializer(), obj))
                "pong" -> obj["c"]?.jsonPrimitive?.content?.toLongOrNull()?.let {
                    val ms = ((System.nanoTime() - it) / 1_000_000L).toInt()
                    pingMs = ms
                    synchronized(recentPings) {
                        recentPings.addLast(ms)
                        if (recentPings.size > 10) recentPings.removeFirst()
                        pingMinMs = recentPings.min()
                    }
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
        private const val RENDER_DELAY_MS = 100.0
        // TCP_NODELAY: send each tiny input message at once instead of batching them (Nagle's algorithm).
        private val client = OkHttpClient.Builder()
            .pingInterval(15, TimeUnit.SECONDS)
            .socketFactory(NoDelaySocketFactory())
            .build()
    }
}

/** Opens sockets with TCP_NODELAY so small game messages are not held back. */
private class NoDelaySocketFactory : javax.net.SocketFactory() {
    private val base = javax.net.SocketFactory.getDefault()
    private fun tune(s: java.net.Socket) = s.apply { tcpNoDelay = true }
    override fun createSocket() = tune(base.createSocket())
    override fun createSocket(host: String, port: Int) = tune(base.createSocket(host, port))
    override fun createSocket(host: String, port: Int, localHost: java.net.InetAddress, localPort: Int) =
        tune(base.createSocket(host, port, localHost, localPort))
    override fun createSocket(host: java.net.InetAddress, port: Int) = tune(base.createSocket(host, port))
    override fun createSocket(address: java.net.InetAddress, port: Int, localAddress: java.net.InetAddress, localPort: Int) =
        tune(base.createSocket(address, port, localAddress, localPort))
}
