package com.fightingarena.app.data

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.fightingarena.app.BuildConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** What the newest published build is (written by CI next to the APK). */
@Serializable
data class VersionInfo(val versionCode: Int, val versionName: String)

sealed interface UpdateState {
    data object Unknown : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Available(val info: VersionInfo) : UpdateState
    data class Downloading(val info: VersionInfo, val progress: Float) : UpdateState
    data class Failed(val message: String) : UpdateState
}

/**
 * In-app updates: checks the latest CI release, downloads the APK and opens the system installer.
 * Android always asks the player to confirm the install; the app keeps its data and login.
 */
class Updater(private val context: Context) {
    private val _state = MutableStateFlow<UpdateState>(UpdateState.Unknown)
    val state: StateFlow<UpdateState> = _state
    private val http = OkHttpClient.Builder().readTimeout(30, TimeUnit.SECONDS).build()
    // Downloads run here, not in a screen, so leaving the screen does not cut them off.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var download: Job? = null

    suspend fun checkForUpdate() {
        if (download?.isActive == true) return
        _state.value = UpdateState.Checking
        _state.value = withContext(Dispatchers.IO) {
            runCatching {
                val request = Request.Builder().url(BuildConfig.UPDATE_BASE_URL + "version.json").build()
                http.newCall(request).execute().use { res ->
                    check(res.isSuccessful) { "HTTP ${res.code}" }
                    json.decodeFromString(VersionInfo.serializer(), res.body!!.string())
                }
            }.fold(
                onSuccess = { if (it.versionCode > BuildConfig.VERSION_CODE) UpdateState.Available(it) else UpdateState.UpToDate },
                onFailure = { UpdateState.Failed("Не удалось проверить обновления") },
            )
        }
    }

    /** Downloads the new APK and starts the installer, in the background of the whole app. */
    fun install(info: VersionInfo) {
        if (download?.isActive == true) return
        download = scope.launch { downloadAndInstall(info) }
    }

    private suspend fun downloadAndInstall(info: VersionInfo) {
        if (!context.packageManager.canRequestPackageInstalls()) {
            // One-time permission: "Allow installing apps from this source".
            val intent = Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        }
        _state.value = UpdateState.Downloading(info, 0f)
        val file = withContext(Dispatchers.IO) {
            runCatching {
                val dir = File(context.cacheDir, "updates").apply { mkdirs() }
                val out = File(dir, "arena.apk")
                val request = Request.Builder().url(BuildConfig.UPDATE_BASE_URL + "arena.apk").build()
                http.newCall(request).execute().use { res ->
                    check(res.isSuccessful) { "HTTP ${res.code}" }
                    val body = res.body!!
                    val total = body.contentLength().toFloat()
                    body.byteStream().use { input ->
                        out.outputStream().use { output ->
                            val buf = ByteArray(64 * 1024)
                            var done = 0L
                            while (true) {
                                val n = input.read(buf)
                                if (n < 0) break
                                output.write(buf, 0, n)
                                done += n
                                // GitHub may not say the size: then progress is -1 and the bar just runs.
                                _state.value = UpdateState.Downloading(info, if (total > 0) done / total else -1f)
                            }
                        }
                    }
                }
                out
            }.getOrNull()
        }
        if (file == null) {
            _state.value = UpdateState.Failed("Не удалось скачать обновление")
            return
        }
        _state.value = UpdateState.Available(info)
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
