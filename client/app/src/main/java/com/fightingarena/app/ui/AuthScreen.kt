package com.fightingarena.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.Credentials
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(app: ArenaApp) {
    var registering by rememberSaveable { mutableStateOf(false) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { if (username.isEmpty()) username = app.session.lastUsername() }

    fun submit() {
        busy = true
        error = null
        scope.launch {
            val creds = Credentials(username.trim(), password)
            val result = app.call { if (registering) app.api.register(creds) else app.api.login(creds) }
            result.onSuccess { app.session.signIn(it) }
            error = result.errorText()
            busy = false
        }
    }

    Column(
        Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Арена бойцов", style = MaterialTheme.typography.headlineLarge)
        Text(if (registering) "Новый боец" else "Вход", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Имя бойца") },
            singleLine = true,
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Пароль") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        )
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        Button(
            onClick = ::submit,
            enabled = !busy && username.isNotBlank() && password.isNotEmpty(),
            modifier = Modifier.widthIn(max = 420.dp).fillMaxWidth(),
        ) { Text(if (registering) "Зарегистрироваться" else "Войти") }
        TextButton(onClick = { registering = !registering; error = null }) {
            Text(if (registering) "Уже есть аккаунт? Войти" else "Нет аккаунта? Регистрация")
        }
    }
}
