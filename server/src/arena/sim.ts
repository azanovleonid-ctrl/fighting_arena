// Authoritative real-time arena simulation. Pure state + fixed steps, no timers or sockets,
// so the server loop and the tests drive it the same way.
import { maxHpFor, type Stats } from "../game/progression.js";
import { HEIGHT, isBush, lineOfSight, resolveWalls, SPAWNS, isWall, WIDTH } from "./map.js";

export type Rng = () => number;

export const PLAYER_RADIUS = 28;
export const BULLET_RADIUS = 10;
export const AMMO_MAX = 3;
export const SHOT_COOLDOWN_MS = 300;
export const BULLET_SPEED = 1000;
export const BULLET_RANGE = 640;
export const SUPER_BULLETS = 9;
export const SUPER_SPREAD = Math.PI / 3;
export const SUPER_RANGE = 520;
export const SUPER_PER_HIT = 0.25;
export const RESPAWN_MS = 3000;
export const REGEN_DELAY_MS = 3000;
export const REGEN_PER_SEC = 0.13;
export const BUSH_REVEAL_DIST = 160;
export const SHOT_REVEAL_MS = 1000;

export const speedFor = (s: Stats) => 224 + 12 * s.agility;
export const damageFor = (s: Stats) => 320 + 60 * s.strength;
export const reloadMsFor = (s: Stats) => Math.max(800, 1500 - 60 * (s.intuition - 3));

export interface Vec {
  x: number;
  y: number;
}

export interface Player {
  id: number;
  name: string;
  userId: string | null; // null for bots
  stats: Stats;
  color: number;
  x: number;
  y: number;
  facing: number;
  moveX: number;
  moveY: number;
  hp: number;
  maxHp: number;
  ammo: number;
  superCharge: number;
  alive: boolean;
  respawnAt: number;
  lastHurtAt: number;
  lastShotAt: number;
  kills: number;
  deaths: number;
  damageDealt: number;
  bot?: BotBrain;
}

interface BotBrain {
  wander: Vec | null;
  strafe: number;
  nextThinkAt: number;
  lastX: number;
  lastY: number;
}

export interface Bullet {
  id: number;
  ownerId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rangeLeft: number;
  damage: number;
  isSuper: boolean;
}

export interface KillEvent {
  time: number;
  killer: string;
  victim: string;
}

export interface Placement {
  playerId: number;
  userId: string | null;
  name: string;
  place: number;
  kills: number;
  deaths: number;
  damage: number;
}

export class Match {
  time = 0;
  readonly players = new Map<number, Player>();
  bullets: Bullet[] = [];
  kills: KillEvent[] = [];
  private nextId = 1;

  constructor(
    readonly durationMs: number,
    private readonly rng: Rng,
  ) {}

  get timeLeftMs() {
    return Math.max(0, this.durationMs - this.time);
  }

  get isOver() {
    return this.time >= this.durationMs;
  }

  addPlayer(name: string, stats: Stats, userId: string | null): Player {
    const maxHp = maxHpFor(stats);
    const p: Player = {
      id: this.nextId++,
      name,
      userId,
      stats,
      color: this.players.size,
      x: 0,
      y: 0,
      facing: 0,
      moveX: 0,
      moveY: 0,
      hp: maxHp,
      maxHp,
      ammo: AMMO_MAX,
      superCharge: 0,
      alive: true,
      respawnAt: 0,
      lastHurtAt: -Infinity,
      lastShotAt: -Infinity,
      kills: 0,
      deaths: 0,
      damageDealt: 0,
      bot: userId === null ? { wander: null, strafe: 1, nextThinkAt: 0, lastX: 0, lastY: 0 } : undefined,
    };
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  removePlayer(id: number) {
    this.players.delete(id);
  }

  /** Stores a movement direction; any length is clamped to 1. */
  setMove(id: number, mx: number, my: number) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(mx) || !Number.isFinite(my)) return;
    const len = Math.hypot(mx, my);
    p.moveX = len > 1 ? mx / len : mx;
    p.moveY = len > 1 ? my / len : my;
  }

  /** Fires one bullet. A zero aim vector auto-aims at the nearest visible enemy. */
  fire(id: number, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !p.alive || p.ammo < 1 || this.time - p.lastShotAt < SHOT_COOLDOWN_MS) return false;
    const dir = this.aimDirection(p, ax, ay);
    if (!dir) return false;
    p.ammo -= 1;
    p.lastShotAt = this.time;
    p.facing = Math.atan2(dir.y, dir.x);
    this.spawnBullet(p, p.facing, BULLET_RANGE, damageFor(p.stats), false);
    return true;
  }

  /** Releases a fully charged super: a cone of bullets. */
  useSuper(id: number, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !p.alive || p.superCharge < 1) return false;
    const dir = this.aimDirection(p, ax, ay);
    if (!dir) return false;
    p.superCharge = 0;
    p.lastShotAt = this.time;
    p.facing = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < SUPER_BULLETS; i++) {
      const angle = p.facing - SUPER_SPREAD / 2 + (SUPER_SPREAD * i) / (SUPER_BULLETS - 1);
      this.spawnBullet(p, angle, SUPER_RANGE, Math.round(damageFor(p.stats) * 0.8), true);
    }
    return true;
  }

  step(dtMs: number) {
    this.time += dtMs;
    const dt = dtMs / 1000;
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (p.bot) this.think(p);
      if (p.moveX || p.moveY) {
        const speed = speedFor(p.stats) * dt;
        const pos = resolveWalls(p.x + p.moveX * speed, p.y + p.moveY * speed, PLAYER_RADIUS);
        p.x = pos.x;
        p.y = pos.y;
        if (this.time - p.lastShotAt > 400) p.facing = Math.atan2(p.moveY, p.moveX);
      }
      if (p.ammo < AMMO_MAX) p.ammo = Math.min(AMMO_MAX, p.ammo + dtMs / reloadMsFor(p.stats));
      if (this.time - Math.max(p.lastHurtAt, p.lastShotAt) >= REGEN_DELAY_MS) {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * REGEN_PER_SEC * dt);
      }
    }
    this.moveBullets(dt);
  }

  /** Whether `viewer` can currently see `target` (bushes hide players). */
  canSee(viewer: Player, target: Player): boolean {
    if (viewer.id === target.id || !isBush(target.x, target.y)) return true;
    if (this.time - target.lastShotAt < SHOT_REVEAL_MS) return true;
    return Math.hypot(viewer.x - target.x, viewer.y - target.y) < BUSH_REVEAL_DIST;
  }

  results(): Placement[] {
    return [...this.players.values()]
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damageDealt - a.damageDealt)
      .map((p, i) => ({
        playerId: p.id,
        userId: p.userId,
        name: p.name,
        place: i + 1,
        kills: p.kills,
        deaths: p.deaths,
        damage: Math.round(p.damageDealt),
      }));
  }

  private aimDirection(p: Player, ax: number, ay: number): Vec | null {
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null;
    const len = Math.hypot(ax, ay);
    if (len > 0.01) return { x: ax / len, y: ay / len };
    const target = this.nearestEnemy(p, BULLET_RANGE + 100);
    if (!target) return { x: Math.cos(p.facing), y: Math.sin(p.facing) };
    const d = Math.hypot(target.x - p.x, target.y - p.y) || 1;
    return { x: (target.x - p.x) / d, y: (target.y - p.y) / d };
  }

  private spawnBullet(p: Player, angle: number, range: number, damage: number, isSuper: boolean) {
    const vx = Math.cos(angle) * BULLET_SPEED;
    const vy = Math.sin(angle) * BULLET_SPEED;
    this.bullets.push({ id: this.nextId++, ownerId: p.id, x: p.x, y: p.y, vx, vy, rangeLeft: range, damage, isSuper });
  }

  private moveBullets(dt: number) {
    const survivors: Bullet[] = [];
    for (const b of this.bullets) {
      // Sub-steps keep fast bullets from skipping through walls or players.
      const dist = BULLET_SPEED * dt;
      const steps = Math.max(1, Math.ceil(dist / 20));
      let alive = true;
      for (let i = 0; i < steps && alive; i++) {
        b.x += (b.vx * dt) / steps;
        b.y += (b.vy * dt) / steps;
        b.rangeLeft -= dist / steps;
        if (b.rangeLeft <= 0 || isWall(b.x, b.y)) {
          alive = false;
          break;
        }
        for (const target of this.players.values()) {
          if (target.id === b.ownerId || !target.alive) continue;
          if (Math.hypot(target.x - b.x, target.y - b.y) <= PLAYER_RADIUS + BULLET_RADIUS) {
            this.hit(b, target);
            alive = false;
            break;
          }
        }
      }
      if (alive) survivors.push(b);
    }
    this.bullets = survivors;
  }

  private hit(b: Bullet, target: Player) {
    const owner = this.players.get(b.ownerId);
    const damage = Math.min(target.hp, b.damage);
    target.hp -= damage;
    target.lastHurtAt = this.time;
    if (owner) {
      owner.damageDealt += damage;
      if (!b.isSuper) owner.superCharge = Math.min(1, owner.superCharge + SUPER_PER_HIT);
    }
    if (target.hp <= 0) {
      target.alive = false;
      target.deaths += 1;
      target.respawnAt = this.time + RESPAWN_MS;
      target.moveX = 0;
      target.moveY = 0;
      if (owner) owner.kills += 1;
      this.kills.push({ time: this.time, killer: owner?.name ?? "?", victim: target.name });
      if (this.kills.length > 20) this.kills.shift();
    }
  }

  /** Puts a player at the spawn point farthest from living enemies, at full health. */
  private spawn(p: Player) {
    const enemies = [...this.players.values()].filter((o) => o.id !== p.id && o.alive);
    const scored = SPAWNS.map((s) => ({
      s,
      d: enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.x - s.x, e.y - s.y))) : this.rng(),
    })).sort((a, b) => b.d - a.d);
    // Pick among the best few so respawns are not fully predictable.
    const choice = scored[Math.floor(this.rng() * Math.min(3, scored.length))].s;
    p.x = choice.x;
    p.y = choice.y;
    p.hp = p.maxHp;
    p.ammo = AMMO_MAX;
    p.alive = true;
    p.lastHurtAt = -Infinity;
  }

  private nearestEnemy(p: Player, maxDist: number): Player | null {
    let best: Player | null = null;
    let bestD = maxDist;
    for (const o of this.players.values()) {
      if (o.id === p.id || !o.alive || !this.canSee(p, o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  private think(p: Player) {
    const brain = p.bot!;
    if (this.time < brain.nextThinkAt) return;
    brain.nextThinkAt = this.time + 100 + this.rng() * 100;

    const target = this.nearestEnemy(p, 900);
    if (target) {
      const dx = target.x - p.x;
      const dy = target.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      if (this.rng() < 0.05) brain.strafe = -brain.strafe;
      // Keep a mid-range distance and circle the target.
      const toward = d > 440 ? 1 : d < 300 ? -1 : 0;
      this.setMove(p.id, ux * toward - uy * brain.strafe * 0.8, uy * toward + ux * brain.strafe * 0.8);
      const sees = lineOfSight(p.x, p.y, target.x, target.y);
      if (sees && p.superCharge >= 1 && d < SUPER_RANGE - 40) {
        this.useSuper(p.id, dx, dy);
      } else if (sees && d < BULLET_RANGE && this.rng() < 0.6) {
        const err = (this.rng() - 0.5) * 0.25;
        const a = Math.atan2(dy, dx) + err;
        this.fire(p.id, Math.cos(a), Math.sin(a));
      }
    } else {
      const stuck = Math.hypot(p.x - brain.lastX, p.y - brain.lastY) < 2;
      if (!brain.wander || stuck || Math.hypot(brain.wander.x - p.x, brain.wander.y - p.y) < 40) {
        brain.wander = { x: 100 + this.rng() * (WIDTH - 200), y: 100 + this.rng() * (HEIGHT - 200) };
      }
      this.setMove(p.id, brain.wander.x - p.x, brain.wander.y - p.y);
    }
    brain.lastX = p.x;
    brain.lastY = p.y;
  }
}
