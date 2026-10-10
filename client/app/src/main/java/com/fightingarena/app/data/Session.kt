package com.fightingarena.app.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore("session")
private val TOKEN = stringPreferencesKey("token")

/** Keeps the auth token on disk and the current profile in memory. */
class Session(private val context: Context) {
    @Volatile var token: String? = null
        private set

    val profile = MutableStateFlow<Profile?>(null)
    private val _loggedIn = MutableStateFlow<Boolean?>(null) // null until the stored token is read
    val loggedIn: StateFlow<Boolean?> = _loggedIn

    suspend fun load() {
        token = context.dataStore.data.map { it[TOKEN] }.first()
        _loggedIn.value = token != null
    }

    suspend fun signIn(auth: AuthResponse) {
        context.dataStore.edit { it[TOKEN] = auth.token }
        token = auth.token
        profile.value = auth.user
        _loggedIn.value = true
    }

    suspend fun signOut() {
        context.dataStore.edit { it.remove(TOKEN) }
        token = null
        profile.value = null
        _loggedIn.value = false
    }
}
