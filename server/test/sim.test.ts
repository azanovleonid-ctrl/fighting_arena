import { describe, expect, it } from "vitest";
import { BASE_STATS } from "../src/game/progression.js";
import { isWall, LAYOUT, resolveWalls, SPAWNS, TILE } from "../src/arena/map.js";
import { AMMO_MAX, damageFor, Match, PLAYER_RADIUS, RESPAWN_MS, speedFor } from "../src/arena/sim.js";

const rng = () => 0.5;

function duel() {
  const m = new Match(60_000, rng);
  const a = m.addPlayer("A", BASE_STATS, "1");
  const b = m.addPlayer("B", BASE_STATS, "2");
  // Open floor on row 2, away from walls and bushes.
  Object.assign(a, { x: 3 * TILE, y: 2.5 * TILE });
  Object.assign(b, { x: 8 * TILE, y: 2.5 * TILE });
  return { m, a, b };
}

describe("map", () => {
  it("is a closed rectangle with spawn points on floor", () => {
    expect(new Set(LAYOUT.map((r) => r.length)).size).toBe(1);
    expect(LAYOUT[0]).toMatch(/^#+$/);
    expect(LAYOUT[LAYOUT.length - 1]).toMatch(/^#+$/);
    expect(SPAWNS.length).toBeGreaterThanOrEqual(6);
    for (const s of SPAWNS) expect(isWall(s.x, s.y)).toBe(false);
  });

  it("pushes a circle out of walls", () => {
    const p = resolveWalls(TILE + 5, 2.5 * TILE, PLAYER_RADIUS);
    expect(p.x).toBeCloseTo(TILE + PLAYER_RADIUS);
  });
});

describe("match", () => {
  it("moves players at their speed and stops them at walls", () => {
    const { m, a } = duel();
    m.setMove(a.id, 0, 1);
    m.step(100);
    expect(a.y).toBeCloseTo(2.5 * TILE + speedFor(BASE_STATS) * 0.1);
    m.setMove(a.id, 0, -1);
    for (let i = 0; i < 30; i++) m.step(100);
    expect(a.y).toBeCloseTo(TILE + PLAYER_RADIUS); // row 0 is wall
  });

  it("shoots, spends ammo, damages and charges super", () => {
    const { m, a, b } = duel();
    expect(m.fire(a.id, 1, 0)).toBe(true);
    expect(a.ammo).toBe(AMMO_MAX - 1);
    expect(m.fire(a.id, 1, 0)).toBe(false); // cooldown
    for (let i = 0; i < 10; i++) m.step(50);
    expect(b.hp).toBe(b.maxHp - damageFor(BASE_STATS));
    expect(a.superCharge).toBeCloseTo(0.25);
    expect(a.damageDealt).toBe(damageFor(BASE_STATS));
  });

  it("auto-aims at the nearest enemy with a zero aim vector", () => {
    const { m, a, b } = duel();
    b.y = a.y - 40;
    b.x = a.x + 200;
    m.fire(a.id, 0, 0);
    for (let i = 0; i < 10; i++) m.step(50);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it("kills, counts the kill and respawns after a delay", () => {
    const { m, a, b } = duel();
    b.hp = 10;
    m.fire(a.id, 1, 0);
    for (let i = 0; i < 10; i++) m.step(50);
    expect(b.alive).toBe(false);
    expect(a.kills).toBe(1);
    expect(b.deaths).toBe(1);
    for (let i = 0; i < RESPAWN_MS / 50 + 1; i++) m.step(50);
    expect(b.alive).toBe(true);
    expect(b.hp).toBe(b.maxHp);
  });

  it("releases a super only when charged", () => {
    const { m, a } = duel();
    expect(m.useSuper(a.id, 1, 0)).toBe(false);
    a.superCharge = 1;
    expect(m.useSuper(a.id, 1, 0)).toBe(true);
    expect(m.bullets.length).toBe(9);
    expect(a.superCharge).toBe(0);
  });

  it("regenerates after a quiet period", () => {
    const { m, b } = duel();
    b.hp = 1000;
    m.step(1000);
    expect(b.hp).toBeGreaterThan(1000);
  });

  it("hides players in bushes from distant viewers", () => {
    const { m, a, b } = duel();
    // Row 1, column 11 is a bush.
    Object.assign(b, { x: 11.5 * TILE, y: 1.5 * TILE });
    expect(m.canSee(a, b)).toBe(false);
    a.x = b.x - 100;
    a.y = b.y;
    expect(m.canSee(a, b)).toBe(true);
  });

  it("ends after its duration and ranks by kills", () => {
    const { m, a, b } = duel();
    a.kills = 1;
    while (!m.isOver) m.step(1000);
    const res = m.results();
    expect(res[0]).toMatchObject({ name: "A", place: 1 });
    expect(res[1]).toMatchObject({ name: "B", place: 2 });
    expect(b.id).toBe(res[1].playerId);
  });

  it("bots move and fight on their own", () => {
    const m = new Match(30_000, Math.random);
    for (let i = 0; i < 6; i++) m.addPlayer(`bot${i}`, BASE_STATS, null);
    const start = [...m.players.values()].map((p) => ({ x: p.x, y: p.y }));
    for (let i = 0; i < 900; i++) m.step(33);
    const moved = [...m.players.values()].filter((p, i) => Math.hypot(p.x - start[i].x, p.y - start[i].y) > 50);
    expect(moved.length).toBeGreaterThan(3);
    const totalDamage = [...m.players.values()].reduce((s, p) => s + p.damageDealt, 0);
    expect(totalDamage).toBeGreaterThan(0);
    for (const p of m.players.values()) expect(isWall(p.x, p.y)).toBe(false);
  });
});
