# Арена бойцов 2.0

Клиент-серверная арена для Android в духе Brawl Stars: бои в реальном времени, аккаунты, прокачка, персональные настройки и история матчей.

- `server/` — игровой сервер на Node.js + TypeScript (Fastify, WebSocket, PostgreSQL). Вся механика боя считается на сервере.
- `client/` — Android-приложение на Kotlin + Jetpack Compose: вход и регистрация, профиль, арена с джойстиками, история, настройки.

## Как играется

Правила и все числа описаны в [дизайн-документе](docs/design.md); если код и документ расходятся, прав документ.

- **8 бойцов:** Кувалда, Искра, Бумер, Винтик, Тень, Гром, Вьюга, Стрела. У каждого своё оружие и суперспособность.
- **4 режима:** Выживание (6 × 1, газ, ящики и кубы силы), Парное выживание (3 × 2, возвращение к напарнику), Мяч (3 × 3, два гола), Маяк (3 × 3, удержание круга в центре).
- Арены 30 × 30 клеток, свободные места занимают боты.
- Левый палец двигает бойца, правый целится; отпустил — выстрел, короткий тап — выстрел в ближайшего врага. Кнопку «Супер» можно нажать (автоприцел) или потянуть, чтобы прицелиться.

## API

Все запросы, кроме `/auth/*` и `/health`, требуют заголовок `Authorization: Bearer <token>`.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/auth/register` | `{username, password}` → `{token, user}` |
| POST | `/auth/login` | `{username, password}` → `{token, user}` |
| GET | `/me` | профиль: уровень, опыт, характеристики, статистика, настройки |
| GET / PATCH | `/me/settings` | настройки `{language, theme, sound, vibration, brawler, mode}`; PATCH меняет только переданные поля |
| POST | `/me/stats` | старые очки характеристик (в бою больше не используются) |
| GET | `/matches?limit=20&before=<id>` | история матчей |
| WS | `/arena?token=<token>` | бой в реальном времени, см. ниже |

### Протокол `/arena`

Клиент шлёт JSON: `{"t":"play","mode":"survival|duo|ball|beacon","brawler":"hammer|spark|boomer|tinker|shade|thunder|blizzard|arrow"}` — встать в очередь, `{"t":"move","mx":0.7,"my":-0.7}` — направление движения,
`{"t":"fire","ax":1,"ay":0}` — выстрел (нулевой вектор = автоприцел, длина 0–1 = дальность броска), `{"t":"super","ax":1,"ay":0}`.

Сервер шлёт `hello`, `queued`, `start` (карта и id игрока), `state` 30 раз в секунду (видимые игроки, снаряды, турели, зоны,
кубы, ящики, газ, мяч или маяк, свои заряды и супер) и `end` (места, победы над соперниками, полученный опыт). В выживании
`end` приходит сразу, как только игрок выбыл.

## Локальный запуск

```bash
cd server
npm install
# нужен PostgreSQL; по умолчанию postgres://arena:arena@localhost:5432/arena
npm run dev
npm test        # тесты используют TEST_DATABASE_URL (по умолчанию postgres://arena@localhost:5432/arena_test)
```

## Развёртывание в Yandex Cloud

1. Создайте ВМ в Compute Cloud (Ubuntu, 2 vCPU, 2 ГБ хватит для начала) с публичным IP и установите Docker.
2. Склонируйте репозиторий на ВМ и создайте в корне `.env`:
   ```
   JWT_SECRET=<длинная случайная строка, например из `openssl rand -hex 32`>
   POSTGRES_PASSWORD=<пароль базы>
   ```
3. Запустите: `docker compose up -d --build`. Сервер слушает порт 3000, миграции базы применяются при старте.
   Обновление: `cd /opt/arena && sudo git pull && sudo docker compose up -d --build`.
4. Для продакшена поставьте перед сервером HTTPS (например, Caddy или Application Load Balancer с сертификатом из Certificate Manager).

Чтобы использовать Managed Service for PostgreSQL вместо базы в Docker, уберите сервис `db` из `docker-compose.yml` и укажите строку подключения к кластеру в `DATABASE_URL`.

## Android-приложение

APK для отладки собирается в CI (артефакт `arena-debug-apk` у каждого запуска). Локально нужен Android Studio или Android SDK и JDK 17:

```bash
cd client
./gradlew assembleDebug                                        # сервер в Yandex Cloud (адрес в gradle.properties)
./gradlew assembleDebug -PapiBaseUrl=http://10.0.2.2:3000/      # эмулятор и сервер на этом же компьютере
```

Пока сервер работает по HTTP, приложение разрешает незашифрованные запросы (`res/xml/network_security_config.xml`). После подключения HTTPS это разрешение нужно убрать.
