package com.fightingarena.app

import android.app.Application
import com.fightingarena.app.data.ArenaApi
import com.fightingarena.app.data.Session
import com.fightingarena.app.data.createApi

class ArenaApp : Application() {
    lateinit var session: Session
        private set
    lateinit var api: ArenaApi
        private set

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
        api = createApi { session.token }
    }
}
