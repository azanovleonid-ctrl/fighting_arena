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
  app = await buildApp({ pool, jwtSecret: "test" });
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
    expect(me.json()).toMatchObject({ username: "Боец_1", level: 1, maxHp: 70, settings: { language: "ru", sound: true } });
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

describe("fights", () => {
  it("plays a fight to the end and records history and xp", async () => {
    const token = await register("fighter");
    const start = await app.inject({ method: "POST", url: "/fights", headers: auth(token) });
    expect(start.statusCode).toBe(201);
    const id = start.json().id;
    // Starting again returns the same active fight.
    expect((await app.inject({ method: "POST", url: "/fights", headers: auth(token) })).json().id).toBe(id);

    const badMove = await app.inject({ method: "POST", url: `/fights/${id}/turn`, headers: auth(token), payload: { attack: "head", blocks: ["legs", "legs"] } });
    expect(badMove.statusCode).toBe(400);

    let fight = start.json();
    while (fight.status === "active") {
      const res = await app.inject({
        method: "POST",
        url: `/fights/${id}/turn`,
        headers: auth(token),
        payload: { attack: "head", blocks: ["chest", "belly"] },
      });
      expect(res.statusCode).toBe(200);
      fight = res.json();
    }
    expect(["win", "loss", "draw"]).toContain(fight.result);
    expect(fight.xpGained).toBeGreaterThan(0);

    const again = await app.inject({ method: "POST", url: `/fights/${id}/turn`, headers: auth(token), payload: { attack: "head", blocks: ["chest", "belly"] } });
    expect(again.statusCode).toBe(409);

    const history = await app.inject({ method: "GET", url: "/fights", headers: auth(token) });
    expect(history.json().items).toHaveLength(1);
    expect(history.json().items[0]).toMatchObject({ id, result: fight.result });

    const me = (await app.inject({ method: "GET", url: "/me", headers: auth(token) })).json();
    expect(me.record.wins + me.record.losses + me.record.draws).toBe(1);
    expect(me.xp).toBe(fight.xpGained);
  });

  it("does not show one player's fights to another", async () => {
    const a = await register("owner_a");
    const b = await register("owner_b");
    const id = (await app.inject({ method: "POST", url: "/fights", headers: auth(a) })).json().id;
    expect((await app.inject({ method: "GET", url: `/fights/${id}`, headers: auth(b) })).statusCode).toBe(404);
  });

  it("spends free stat points only when available", async () => {
    const token = await register("stats_user");
    const none = await app.inject({ method: "POST", url: "/me/stats", headers: auth(token), payload: { strength: 1 } });
    expect(none.statusCode).toBe(400);
    await pool.query("UPDATE users SET free_points = 2 WHERE username = 'stats_user'");
    const ok = await app.inject({ method: "POST", url: "/me/stats", headers: auth(token), payload: { strength: 1, endurance: 1 } });
    expect(ok.json()).toMatchObject({ freePoints: 0, stats: { strength: 4, endurance: 4 }, maxHp: 80 });
  });
});
