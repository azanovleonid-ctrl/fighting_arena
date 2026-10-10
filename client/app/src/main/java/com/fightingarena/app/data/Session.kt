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
private val LAST_USERNAME = stringPreferencesKey("last_username")

/** Keeps the auth token on disk and the current profile in memory. */
class Session(private val context: Context) {
    @Volatile var token: String? = null
        private set

    val profile = MutableStateFlow<Profile?>(null)
    private val _loggedIn = MutableStateFlow<Boolean?>(null) // null until the stored token is read
    val loggedIn: StateFlow<Boolean?> = _loggedIn

    /** Name of the last fighter who signed in on this phone, to prefill the login form. */
    suspend fun lastUsername(): String = context.dataStore.data.map { it[LAST_USERNAME] }.first().orEmpty()

    suspend fun load() {
        token = context.dataStore.data.map { it[TOKEN] }.first()
        _loggedIn.value = token != null
    }

    suspend fun signIn(auth: AuthResponse) {
        context.dataStore.edit {
            it[TOKEN] = auth.token
            it[LAST_USERNAME] = auth.user.username
        }
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
