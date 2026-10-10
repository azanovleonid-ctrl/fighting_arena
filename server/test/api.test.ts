import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL ?? "postgres://arena@localhost:5432/arena_test" });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool);
  await migrate(pool); // idempotent
  app = await buildApp({ pool, jwtSecret: "test", arena: { queueWaitMs: 50, durationMs: 1500, tickMs: 33 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function register(username: string) {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { username, password: "secret1" } });
  expect(res.statusCode).toBe(201);
  return res.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const wsUrl = () => {
  const addr = app.server.address() as { port: number };
  return `ws://127.0.0.1:${addr.port}/arena`;
};

describe("accounts", () => {
  it("registers, rejects duplicates case-insensitively, and logs in", async () => {
    await register("Боец_1");
    const dup = await app.inject({ method: "POST", url: "/auth/register", payload: { username: "боец_1", password: "secret1" } });
    expect(dup.statusCode).toBe(409);
    const bad = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "Боец_1", password: "nope" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/auth/login", payload: { username: "боец_1", password: "secret1" } });
    expect(ok.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/me", headers: auth(ok.json().token) });
    expect(me.json()).toMatchObject({ username: "Боец_1", level: 1, maxHp: 3000, settings: { language: "ru", sound: true } });
  });

  it("rejects requests without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
  });

  it("validates registration input", async () => {
    const res = await app.inject({ method: "POST", url: "/auth/register", payload: { username: "a", password: "1" } });
    expect(res.statusCode).toBe(400);
  });

  it("updates settings partially", async () => {
    const token = await register("settings_user");
    const res = await app.inject({ method: "PATCH", url: "/me/settings", headers: auth(token), payload: { sound: false } });
    expect(res.json()).toEqual({ language: "ru", theme: "dark", sound: false, vibration: true });
    const bad = await app.inject({ method: "PATCH", url: "/me/settings", headers: auth(token), payload: { volume: 3 } });
    expect(bad.statusCode).toBe(400);
  });
});

describe("profile", () => {
  it("spends free stat points only when available", async () => {
    const token = await register("stats_user");
    const none = await app.inject({ method: "POST", url: "/me/stats", headers: auth(token), payload: { strength: 1 } });
    expect(none.statusCode).toBe(400);
    await pool.query("UPDATE users SET free_points = 2 WHERE username = 'stats_user'");
    const ok = await app.inject({ method: "POST", url: "/me/stats", headers: auth(token), payload: { strength: 1, endurance: 1 } });
    expect(ok.json()).toMatchObject({ freePoints: 0, stats: { strength: 4, endurance: 4 }, maxHp: 3200 });
  });
});

describe("arena", () => {
  it("rejects a bad token", async () => {
    const ws = new WebSocket(`${wsUrl()}?token=nope`);
    const code = await new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve(e.code)));
    expect(code).toBe(4401);
  });

  it("plays a full match against bots and saves the result", async () => {
    const token = await register("arena_player");
    const ws = new WebSocket(`${wsUrl()}?token=${token}`);
    const seen: Record<string, any> = {};
    let states = 0;
    const ended = new Promise<any>((resolve) => {
      ws.addEventListener("message", (e) => {
        const msg = JSON.parse(String(e.data));
        if (msg.t === "hello") ws.send(JSON.stringify({ t: "play" }));
        if (msg.t === "start") ws.send(JSON.stringify({ t: "move", mx: 1, my: 0 }));
        if (msg.t === "state") {
          states++;
          if (states === 3) ws.send(JSON.stringify({ t: "fire", ax: 0, ay: 0 }));
        }
        seen[msg.t] = msg;
        if (msg.t === "end") resolve(msg);
      });
    });
    const end = await ended;
    ws.close();
    expect(seen.start.map.layout.length).toBeGreaterThan(0);
    expect(seen.state.players.length).toBeGreaterThan(0);
    expect(seen.state.me.ammo).toBeGreaterThanOrEqual(0);
    expect(states).toBeGreaterThan(10);
    expect(end.results).toHaveLength(6);
    expect(end.results.filter((r: any) => r.you)).toHaveLength(1);
    expect(end.xpGained).toBeGreaterThan(0);

    const history = (await app.inject({ method: "GET", url: "/matches", headers: auth(token) })).json();
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ place: end.place, players: 6 });
    const me = (await app.inject({ method: "GET", url: "/me", headers: auth(token) })).json();
    expect(me.xp + (me.level - 1) * 50).toBeGreaterThanOrEqual(end.xpGained);
  }, 10_000);
});
