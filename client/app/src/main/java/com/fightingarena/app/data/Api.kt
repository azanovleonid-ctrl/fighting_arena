package com.fightingarena.app.data

import com.fightingarena.app.BuildConfig
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query
import java.io.IOException

interface ArenaApi {
    @POST("auth/register") suspend fun register(@Body body: Credentials): AuthResponse
    @POST("auth/login") suspend fun login(@Body body: Credentials): AuthResponse

    @GET("me") suspend fun me(): Profile
    @PATCH("me/settings") suspend fun updateSettings(@Body body: Settings): Settings
    @POST("me/stats") suspend fun spendPoints(@Body body: StatPoints): Profile

    @POST("fights") suspend fun startFight(): Fight
    @GET("fights/{id}") suspend fun fight(@Path("id") id: String): Fight
    @POST("fights/{id}/turn") suspend fun turn(@Path("id") id: String, @Body move: Move): Fight
    @GET("fights") suspend fun history(@Query("before") before: String? = null, @Query("limit") limit: Int = 20): FightPage
}

val json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
}

fun createApi(tokenProvider: () -> String?): ArenaApi {
    val auth = Interceptor { chain ->
        val token = tokenProvider()
        val request = if (token != null) {
            chain.request().newBuilder().header("Authorization", "Bearer $token").build()
        } else {
            chain.request()
        }
        chain.proceed(request)
    }
    val client = OkHttpClient.Builder().addInterceptor(auth).build()
    return Retrofit.Builder()
        .baseUrl(BuildConfig.API_BASE_URL)
        .client(client)
        .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
        .build()
        .create(ArenaApi::class.java)
}

/** Turns any API failure into a message for the player. */
fun Throwable.userMessage(): String = when (this) {
    is HttpException -> response()?.errorBody()?.string()
        ?.let { runCatching { json.decodeFromString<ApiError>(it).message }.getOrNull() }
        ?: "Ошибка сервера (${code()})"
    is IOException -> "Нет связи с сервером"
    else -> message ?: "Что-то пошло не так"
}

fun Throwable.isUnauthorized() = this is HttpException && code() == 401
