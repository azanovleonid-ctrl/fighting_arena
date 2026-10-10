# Арена бойцов 2.0

Клиент-серверная игра для Android: пошаговые бои, аккаунты, персональные настройки и история боёв.

- `server/` — игровой сервер на Node.js + TypeScript (Fastify, PostgreSQL). Вся логика боя считается на сервере.
- `client/` — Android-приложение на Kotlin + Jetpack Compose: вход и регистрация, профиль, бой, история, настройки.

## Правила боя

Каждый раунд оба бойца одновременно выбирают **одну зону удара** и **две зоны блока** из пяти:
голова, грудь, живот, пояс, ноги.

- Удар в заблокированную зону не проходит, если только он не критический (тогда проходит без бонуса крита).
- Удар в открытую зону может быть отбит уворотом, иначе наносит урон, а крит наносит ×1.5.
- Характеристики: **сила** — урон, **ловкость** — шанс уворота, **интуиция** — шанс крита, **выносливость** — здоровье (40 + 10 за единицу).
- За бой дают опыт (победа 20, ничья 8, поражение 5). Каждый новый уровень даёт одно свободное очко характеристик.
- Бой длится не больше 50 раундов, после этого объявляется ничья.

## API

Все запросы, кроме `/auth/*` и `/health`, требуют заголовок `Authorization: Bearer <token>`.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/auth/register` | `{username, password}` → `{token, user}` |
| POST | `/auth/login` | `{username, password}` → `{token, user}` |
| GET | `/me` | профиль: уровень, опыт, характеристики, статистика, настройки |
| GET / PATCH | `/me/settings` | настройки `{language, theme, sound, vibration}`; PATCH меняет только переданные поля |
| POST | `/me/stats` | распределить свободные очки, например `{strength: 1}` |
| POST | `/fights` | начать бой с ботом (или вернуть текущий) |
| GET | `/fights/active` | текущий бой |
| POST | `/fights/:id/turn` | ход `{attack: "head", blocks: ["chest", "belly"]}` |
| GET | `/fights?limit=20&before=<id>` | история завершённых боёв |
| GET | `/fights/:id` | бой целиком, по раундам |

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
4. Для продакшена поставьте перед сервером HTTPS (например, Caddy или Application Load Balancer с сертификатом из Certificate Manager).

Чтобы использовать Managed Service for PostgreSQL вместо базы в Docker, уберите сервис `db` из `docker-compose.yml` и укажите строку подключения к кластеру в `DATABASE_URL`.

## Android-приложение

APK для отладки собирается в CI (артефакт `arena-debug-apk` у каждого запуска). Локально нужен Android Studio или Android SDK и JDK 17:

```bash
cd client
./gradlew assembleDebug                                        # сервер по адресу эмулятора http://10.0.2.2:3000/
./gradlew assembleDebug -PapiBaseUrl=http://<IP-сервера>:3000/  # для телефона и сервера в Yandex Cloud
```

Пока сервер работает по HTTP, приложение разрешает незашифрованные запросы (`res/xml/network_security_config.xml`). После подключения HTTPS это разрешение нужно убрать.
