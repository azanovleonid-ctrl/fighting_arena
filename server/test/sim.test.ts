import { describe, expect, it } from "vitest";
import { BRAWLER_IDS, BRAWLERS, levelMult, type BrawlerId } from "../src/arena/brawlers.js";
import { ArenaMap, ARENA_SIZE, BALL_LAYOUT, BEACON_LAYOUT, CENTER, goalRect, SURVIVAL_LAYOUTS, SURVIVAL_SPAWNS, TEAM_SPAWNS, TILE } from "../src/arena/map.js";
import {
  AMMO_MAX,
  BEACON_RATE,
  CUBE_HP,
  DUO_RESPAWN_MS,
  GAS_DAMAGE,
  GOAL_PAUSE_MS,
  Match,
  PLAYER_RADIUS,
  SHIELD_MS,
  SLOW_FACTOR,
  type Mode,
} from "../src/arena/sim.js";

// 0.1 picks the first survival arena and keeps bots predictable.
const rng = () => 0.1;
const ROW1 = 1.5 * TILE; // the top row of every survival arena is open floor

function duel(a: BrawlerId, b: BrawlerId, mode: Mode = "survival") {
  const m = new Match(mode, 240_000, rng);
  const pa = m.addPlayer("A", a, 1, "1", 0);
  const pb = m.addPlayer("B", b, 1, "2", 1);
  Object.assign(pa, { x: 3 * TILE, y: ROW1 });
  Object.assign(pb, { x: 3 * TILE + 300, y: ROW1 });
  return { m, a: pa, b: pb };
}

const run = (m: Match, ms: number) => {
  for (let t = 0; t < ms; t += 33) m.step(33);
};

describe("arenas", () => {
  it("are closed 30 × 30 squares with open spawn points", () => {
    for (const layout of [...SURVIVAL_LAYOUTS, BALL_LAYOUT, BEACON_LAYOUT]) {
      expect(layout).toHaveLength(30);
      expect(new Set(layout.map((r) => r.length))).toEqual(new Set([30]));
      expect(layout[0]).toMatch(/^#+$/);
      expect(layout[29]).toMatch(/^#+$/);
      expect(layout.every((r) => r[0] === "#" && r[29] === "#")).toBe(true);
    }
    for (const layout of SURVIVAL_LAYOUTS) {
      const map = new ArenaMap(layout);
      for (const s of SURVIVAL_SPAWNS) expect(map.isSolid(s.x, s.y)).toBe(false);
      expect(map.isSolid(CENTER, CENTER)).toBe(false);
      expect(map.boxes.size).toBeGreaterThanOrEqual(4);
      // Mirrored on both axes, so every start is equally fair.
      expect(layout).toEqual([...layout].reverse());
      expect(layout.map((r) => [...r].reverse().join(""))).toEqual(layout);
    }
    expect(ARENA_SIZE).toBe(1800);
  });

  it("narrows ball and beacon fields to columns 6–23 with free goals and starts", () => {
    for (const layout of [BALL_LAYOUT, BEACON_LAYOUT]) {
      const map = new ArenaMap(layout);
      expect(layout.every((r) => r.slice(0, 6) === "######" && r.slice(24) === "######")).toBe(true);
      for (const team of TEAM_SPAWNS) for (const s of team) expect(map.isSolid(s.x, s.y)).toBe(false);
      expect(map.boxes.size).toBe(0);
    }
    const map = new ArenaMap(BALL_LAYOUT);
    for (const team of [0, 1]) {
      const g = goalRect(team);
      expect(map.isSolid((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2)).toBe(false);
      expect(g.x1 - g.x0).toBe(240);
    }
    expect(goalRect(0).y0).toBeGreaterThan(CENTER); // blue defends the bottom
  });

  it("pushes a circle out of walls", () => {
    const map = new ArenaMap(SURVIVAL_LAYOUTS[0]);
    const p = map.resolveWalls(TILE + 5, ROW1, PLAYER_RADIUS);
    expect(p.x).toBeCloseTo(TILE + PLAYER_RADIUS);
  });
});

describe("brawlers", () => {
  it("has the 8 brawlers from the design document", () => {
    expect(BRAWLER_IDS).toHaveLength(8);
    expect(BRAWLERS.hammer).toMatchObject({ hp: 6000, speed: 245, range: 150, damage: 1500, hitsToSuper: 5 });
    expect(BRAWLERS.arrow).toMatchObject({ hp: 3200, range: 620, reloadMs: 1250 });
    expect(levelMult(9)).toBeCloseTo(1.64);
  });

  it("moves at the brawler's speed, slower when slowed, and stops at walls", () => {
    const { m, a } = duel("shade", "spark");
    m.setMove(a.id, 1, 0);
    m.step(100);
    expect(a.x).toBeCloseTo(3 * TILE + 26.5);
    a.slowUntil = 10_000;
    m.step(100);
    expect(a.x).toBeCloseTo(3 * TILE + 26.5 + 26.5 * SLOW_FACTOR);
    m.setMove(a.id, 0, -1);
    run(m, 1000);
    expect(a.y).toBeCloseTo(TILE + PLAYER_RADIUS);
  });

  it("spends ammo, respects the 0.32 s pause and reloads", () => {
    const { m, a } = duel("tinker", "spark");
    expect(m.fire(a.id, 1, 0)).toBe(true);
    expect(a.ammo).toBe(AMMO_MAX - 1);
    expect(m.fire(a.id, 1, 0)).toBe(false);
    expect(m.shots).toHaveLength(2); // two bolts per shot
    m.step(330);
    expect(m.fire(a.id, 1, 0)).toBe(true);
    expect(a.ammo).toBeCloseTo(AMMO_MAX - 2 + 330 / 1200);
  });

  it("Искра fires 5 pellets that all hit up close and fill 1/23 of the super each", () => {
    const { m, a, b } = duel("spark", "hammer");
    b.x = a.x + 80;
    m.fire(a.id, 1, 0);
    expect(m.shots).toHaveLength(5);
    run(m, 300);
    expect(b.hp).toBe(b.maxHp - 5 * 330);
    expect(a.superCharge).toBeCloseTo(5 / 23);
  });

  it("Кувалда hits everyone in the arc in front, nobody behind", () => {
    const { m, a, b } = duel("hammer", "spark");
    const c = m.addPlayer("C", "spark", 1, null, 2);
    Object.assign(b, { x: a.x + 120, y: a.y });
    Object.assign(c, { x: a.x - 120, y: a.y });
    m.fire(a.id, 1, 0);
    expect(b.hp).toBe(b.maxHp - 1500);
    expect(c.hp).toBe(c.maxHp);
    expect(a.superCharge).toBeCloseTo(1 / 5);
  });

  it("Стрела fires a burst of 3 bullets for one ammo", () => {
    const { m, a, b } = duel("arrow", "hammer");
    m.fire(a.id, 1, 0);
    expect(a.ammo).toBe(AMMO_MAX - 1);
    run(m, 600);
    expect(b.hp).toBe(b.maxHp - 3 * 380);
  });

  it("Бумер's boomerang hits on the way out and on the way back", () => {
    const { m, a, b } = duel("boomer", "hammer");
    m.fire(a.id, 1, 0);
    run(m, 3000);
    expect(b.hp).toBeLessThanOrEqual(b.maxHp - 1200 + 1); // regen may add a little
    expect(m.shots).toHaveLength(0);
  });

  it("Гром's bomb flies over walls and explodes at the aimed spot", () => {
    const m = new Match("survival", 240_000, rng);
    const a = m.addPlayer("A", "thunder", 1, "1");
    const b = m.addPlayer("B", "hammer", 1, "2");
    // Columns 10–11 of rows 4–5 are a wall between them.
    Object.assign(a, { x: 8.5 * TILE, y: 4.5 * TILE });
    Object.assign(b, { x: 13.5 * TILE, y: 4.5 * TILE });
    expect(m.map.lineOfSight(a.x, a.y, b.x, b.y)).toBe(false);
    m.fire(a.id, 300 / 470, 0);
    run(m, 700);
    expect(b.hp).toBe(b.maxHp - 1150);
  });

  it("Вьюга's shard slows the target", () => {
    const { m, a, b } = duel("blizzard", "hammer");
    m.fire(a.id, 1, 0);
    run(m, 400);
    expect(b.hp).toBe(b.maxHp - 900);
    expect(b.slowUntil).toBeGreaterThan(m.time + 1000);
  });

  it("fills the super after the documented number of hits and releases it only when full", () => {
    const { m, a } = duel("thunder", "hammer");
    expect(m.useSuper(a.id, 1, 0)).toBe(false);
    a.superCharge = 1;
    expect(m.useSuper(a.id, 300 / 470, 0)).toBe(true);
    expect(a.superCharge).toBe(0);
    expect(m.shots.filter((s) => s.kind === "bomb")).toHaveLength(5);
  });

  it("Кувалда's jump is untouchable in the air and hurts on landing", () => {
    const { m, a, b } = duel("hammer", "spark");
    a.superCharge = 1;
    m.useSuper(a.id, 300 / 520, 0);
    m.step(100);
    expect(a.jump).not.toBeNull();
    a.hp = a.maxHp - 1;
    const before = a.hp;
    m.fire(b.id, -1, 0);
    run(m, 600);
    expect(a.jump).toBeNull();
    expect(a.hp).toBeGreaterThanOrEqual(before - 330 * 5); // only pellets after landing could land
    expect(b.hp).toBe(b.maxHp - 1700);
  });

  it("Искра's dash hits enemies on the way and knocks them back", () => {
    const { m, a, b } = duel("spark", "hammer");
    b.x = a.x + 200;
    a.superCharge = 1;
    m.useSuper(a.id, 1, 0);
    run(m, 400);
    expect(b.hp).toBe(b.maxHp - 1300);
  });

  it("Винтик's turret shoots nearby enemies by itself", () => {
    const { m, a, b } = duel("tinker", "hammer");
    a.superCharge = 1;
    m.useSuper(a.id, 1, 0);
    expect(m.turrets).toHaveLength(1);
    run(m, 1500);
    expect(b.hp).toBeLessThan(b.maxHp);
    expect(a.superCharge).toBe(0); // turret hits do not charge the super
  });

  it("Тень turns invisible to enemies farther than 90", () => {
    const { m, a, b } = duel("shade", "spark");
    a.superCharge = 1;
    m.useSuper(a.id, 1, 0);
    expect(m.canSee(b, a)).toBe(false);
    b.x = a.x + 80;
    expect(m.canSee(b, a)).toBe(true);
  });
});

describe("rules", () => {
  it("hides brawlers in bushes until they shoot or get hurt", () => {
    const m = new Match("survival", 240_000, rng);
    const a = m.addPlayer("A", "arrow", 1, "1");
    const b = m.addPlayer("B", "arrow", 1, "2");
    // Rows 3–4, columns 4–6 are a bush in the first arena.
    Object.assign(b, { x: 5.5 * TILE, y: 3.5 * TILE });
    Object.assign(a, { x: 5.5 * TILE + 400, y: 3.5 * TILE });
    expect(m.canSee(a, b)).toBe(false);
    m.fire(b.id, -1, 0);
    expect(m.canSee(a, b)).toBe(true);
    m.step(1000);
    expect(m.canSee(a, b)).toBe(false);
    a.x = b.x + 150;
    expect(m.canSee(a, b)).toBe(true);
  });

  it("regenerates 13% per second after 3 quiet seconds", () => {
    const { m, b } = duel("spark", "hammer");
    b.hp = 1000;
    m.step(1000);
    expect(b.hp).toBeCloseTo(1000 + 6000 * 0.13);
  });

  it("applies level and power cube multipliers", () => {
    const m = new Match("survival", 240_000, rng);
    const p = m.addPlayer("A", "spark", 9, "1");
    expect(p.maxHp).toBe(Math.round(4600 * 1.64));
    p.cubes = 2;
    expect(m.maxHpOf(p)).toBe(Math.round(4600 * 1.64 + CUBE_HP * 1.64 * 2));
    expect(m.damageMult(p)).toBeCloseTo(1.64 * 1.2);
  });
});

describe("survival", () => {
  it("ranks by knockout order, drops cubes and ends with one left", () => {
    const m = new Match("survival", 240_000, rng);
    const players = BRAWLER_IDS.slice(0, 3).map((b, i) => m.addPlayer(`P${i}`, b, 1, String(i)));
    const [a, b, c] = players;
    Object.assign(a, { x: 3 * TILE, y: ROW1 });
    Object.assign(b, { x: 3 * TILE + 100, y: ROW1 });
    Object.assign(c, { x: 25 * TILE, y: ROW1 });
    b.hp = 1;
    m.fire(a.id, 1, 0); // hammer
    expect(b.out).toBe(true);
    expect(m.placementOf(b.id)).toMatchObject({ place: 3, result: "loss" });
    expect(m.cubes).toHaveLength(1);
    expect(m.isOver).toBe(false);
    m.step(33);
    Object.assign(c, { x: a.x + 100, y: a.y, hp: 1 });
    m.step(400);
    m.fire(a.id, 1, 0);
    expect(m.isOver).toBe(true);
    const res = m.results();
    expect(res.map((r) => [r.name, r.place, r.result])).toEqual([
      ["P0", 1, "win"],
      ["P2", 2, "loss"],
      ["P1", 3, "loss"],
    ]);
  });

  it("picking a cube adds 10% damage and 400 HP", () => {
    const { m, a } = duel("spark", "hammer");
    m.cubes.push({ id: 999, x: a.x + 10, y: a.y });
    m.step(33);
    expect(a.cubes).toBe(1);
    expect(a.maxHp).toBe(4600 + CUBE_HP);
  });

  it("breaking a box drops a power cube", () => {
    const m = new Match("survival", 240_000, rng);
    const a = m.addPlayer("A", "hammer", 1, "1");
    const index = [...m.map.boxes.keys()][0];
    const box = m.map.boxCenter(index);
    Object.assign(a, { x: box.x - TILE, y: box.y });
    for (let i = 0; i < 3; i++) {
      m.fire(a.id, 1, 0);
      m.step(400);
    }
    expect(m.map.boxes.has(index)).toBe(false);
    expect(m.cubes).toHaveLength(1);
  });

  it("shrinks the gas from 20 s and hurts brawlers outside it", () => {
    const { m, a } = duel("hammer", "spark");
    expect(m.gasRadius).toBe(1296);
    run(m, 20_000);
    expect(a.hp).toBe(a.maxHp);
    run(m, 30_000);
    expect(m.gasRadius).toBeLessThan(1000);
    // Row 1 near the corner is far outside the circle now.
    expect(a.hp < a.maxHp || !a.alive).toBe(true);
    expect(GAS_DAMAGE).toBe(900);
  });
});

describe("duo", () => {
  it("respawns next to a living partner and knocks out the team when both fall", () => {
    const m = new Match("duo", 240_000, rng);
    const a = m.addPlayer("A", "hammer", 1, "1", 0);
    const mate = m.addPlayer("M", "spark", 1, "2", 0);
    const b = m.addPlayer("B", "spark", 1, "3", 1);
    const partner = m.addPlayer("P", "spark", 1, "5", 1);
    m.addPlayer("C", "spark", 1, "4", 2);
    Object.assign(a, { x: 3 * TILE, y: ROW1 });
    Object.assign(b, { x: 3 * TILE + 100, y: ROW1, hp: 1 });
    m.fire(a.id, 1, 0);
    expect(b.alive).toBe(false);
    expect(b.out).toBe(false);
    m.step(DUO_RESPAWN_MS + 50);
    expect(b.alive).toBe(true);
    expect(Math.hypot(b.x - partner.x, b.y - partner.y)).toBeLessThan(120);
    expect(m.time < b.shieldUntil).toBe(true);
    expect(b.shieldUntil - m.time).toBeLessThanOrEqual(SHIELD_MS);

    // Teammates never hurt each other.
    Object.assign(mate, { x: a.x + 100, y: a.y });
    m.step(400);
    m.fire(a.id, 1, 0);
    expect(mate.hp).toBe(mate.maxHp);
  });

  it("puts a team out when the second partner falls before the first comes back", () => {
    const m = new Match("duo", 240_000, rng);
    const killer = m.addPlayer("K", "hammer", 1, "1", 0);
    const a = m.addPlayer("A", "spark", 1, "2", 1);
    const b = m.addPlayer("B", "spark", 1, "3", 1);
    m.addPlayer("C", "spark", 1, "4", 2);
    for (const victim of [a, b]) {
      Object.assign(killer, { x: 3 * TILE, y: ROW1 });
      Object.assign(victim, { x: 3 * TILE + 100, y: ROW1, hp: 1 });
      m.fire(killer.id, 1, 0);
      m.step(400);
    }
    expect(a.out && b.out).toBe(true);
    expect(m.placementOf(a.id)?.place).toBe(3);
  });
});

describe("ball", () => {
  function pitch() {
    const m = new Match("ball", 150_000, rng);
    const a = m.addPlayer("A", "spark", 1, "1", 0);
    const b = m.addPlayer("B", "spark", 1, "2", 1);
    m.step(GOAL_PAUSE_MS); // "Приготовьтесь!"
    return { m, a, b };
  }

  it("starts blue at the bottom and red at the top after a short freeze", () => {
    const m = new Match("ball", 150_000, rng);
    const a = m.addPlayer("A", "spark", 1, "1", 0);
    const b = m.addPlayer("B", "spark", 1, "2", 1);
    expect(a.y).toBeGreaterThan(CENTER);
    expect(b.y).toBeLessThan(CENTER);
    expect(m.isPaused).toBe(true);
    expect(m.fire(a.id, 1, 0)).toBe(false);
  });

  it("carrier is slower, cannot use the super, and kicks the ball into the goal", () => {
    const { m, a } = pitch();
    const goal = m.goalCenter(1);
    Object.assign(m.ball!, { x: goal.x, y: goal.y + 260 });
    Object.assign(a, { x: goal.x, y: goal.y + 300 });
    m.step(33);
    expect(m.ball!.holderId).toBe(a.id);
    a.superCharge = 1;
    expect(m.useSuper(a.id, 0, -1)).toBe(false);
    const y = a.y;
    m.setMove(a.id, 0, 1);
    m.step(100);
    expect(a.y - y).toBeCloseTo(23.5 * 0.85);
    m.setMove(a.id, 0, 0);
    expect(m.fire(a.id, 0, -1)).toBe(true);
    for (let i = 0; i < 40 && m.score[0] === 0; i++) m.step(33);
    expect(m.score).toEqual([1, 0]);
    expect(a.goals).toBe(1);
    expect(m.ball!.x).toBe(CENTER);
    expect(m.isPaused).toBe(true);
  });

  it("knocks the ball loose after 30% of the carrier's health in damage", () => {
    const { m, a, b } = pitch();
    Object.assign(m.ball!, { x: CENTER, y: CENTER });
    Object.assign(a, { x: CENTER, y: CENTER + 30 });
    m.step(33);
    expect(m.ball!.holderId).toBe(a.id);
    Object.assign(b, { x: CENTER, y: CENTER - 100 });
    m.fire(b.id, 0, 1);
    run(m, 300);
    expect(a.maxHp - a.hp).toBeGreaterThanOrEqual(a.maxHp * 0.3);
    expect(m.ball!.holderId).not.toBe(a.id);
  });

  it("reports win, loss or draw by team", () => {
    const { m } = pitch();
    expect(m.results().every((r) => r.result === "draw")).toBe(true);
    m.score = [2, 0];
    expect(m.isOver).toBe(true);
    const res = m.results();
    expect(res.find((r) => r.team === 0)!.result).toBe("win");
    expect(res.find((r) => r.team === 1)!.result).toBe("loss");
  });
});

describe("beacon", () => {
  it("fills the holder's bar, freezes when contested, and wins at 100%", () => {
    const m = new Match("beacon", 150_000, rng);
    const a = m.addPlayer("A", "hammer", 1, "1", 0);
    const b = m.addPlayer("B", "hammer", 1, "2", 1);
    Object.assign(a, { x: CENTER, y: CENTER });
    m.step(1000);
    expect(m.beacon[0]).toBeCloseTo(BEACON_RATE);
    expect(m.beaconState).toBe(0);
    Object.assign(b, { x: CENTER + 100, y: CENTER });
    m.step(1000);
    expect(m.beacon[0]).toBeCloseTo(BEACON_RATE);
    expect(m.beaconState).toBe(2);
    m.beacon[0] = 1;
    expect(m.isOver).toBe(true);
    expect(m.results().find((r) => r.name === "A")!.result).toBe("win");
  });
});

describe("bots", () => {
  it.each(["survival", "duo", "ball", "beacon"] as Mode[])("play a whole %s match without getting stuck in walls", (mode) => {
    let seed = 42;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const m = new Match(mode, 150_000, random);
    for (let i = 0; i < 6; i++) m.addPlayer(`bot${i}`, BRAWLER_IDS[i % 8], 1, null, i % (mode === "duo" ? 3 : 2));
    while (!m.isOver) {
      m.step(33);
      for (const p of m.players.values()) if (p.alive) expect(m.map.isSolid(p.x, p.y)).toBe(false);
    }
    const res = m.results();
    expect(res).toHaveLength(6);
    expect(res.reduce((s, r) => s + r.damage, 0)).toBeGreaterThan(0);
  });
});
