package com.fightingarena.app.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.fightingarena.app.ArenaApp
import com.fightingarena.app.data.FightSummary
import com.fightingarena.app.data.resultTitle
import kotlinx.coroutines.launch

@Composable
fun HistoryScreen(app: ArenaApp, onOpen: (String) -> Unit, onBack: () -> Unit) {
    var items by remember { mutableStateOf(listOf<FightSummary>()) }
    var next by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    suspend fun load(before: String?) {
        val r = app.call { app.api.history(before) }
        r.onSuccess { page ->
            items = if (before == null) page.items else items + page.items
            next = page.nextBefore
        }
        error = r.errorText()
        loaded = true
    }
    LaunchedEffect(Unit) { load(null) }

    Scaffold(topBar = { ArenaTopBar("История боёв", onBack = onBack) }) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                error != null && items.isEmpty() -> Text(error!!, Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.error)
                loaded && items.isEmpty() -> Text("Боёв пока не было", Modifier.align(Alignment.Center))
                else -> LazyColumn {
                    items(items, key = { it.id }) { f ->
                        ListItem(
                            headlineContent = { Text("${resultTitle(f.result)} · ${f.opponent}") },
                            supportingContent = { Text("Раундов: ${f.rounds} · опыт +${f.xpGained}") },
                            modifier = Modifier.clickable { onOpen(f.id) },
                        )
                        HorizontalDivider()
                    }
                    next?.let { before ->
                        item {
                            TextButton(onClick = { scope.launch { load(before) } }, modifier = Modifier.fillMaxWidth()) {
                                Text("Показать ещё")
                            }
                        }
                    }
                }
            }
        }
    }
}
