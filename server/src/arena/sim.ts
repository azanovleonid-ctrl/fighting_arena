// Authoritative real-time arena simulation following docs/design.md. Pure state + fixed steps,
// no timers or sockets, so the server loop and the tests drive it the same way.
import { BRAWLERS, levelMult, type Brawler, type BrawlerId } from "./brawlers.js";
import {
  ArenaMap,
  BALL_LAYOUT,
  BEACON_LAYOUT,
  CENTER,
  goalRect,
  SURVIVAL_LAYOUTS,
  SURVIVAL_SPAWNS,
  TEAM_SPAWNS,
  type Vec,
} from "./map.js";

export type Rng = () => number;
export type Mode = "survival" | "duo" | "ball" | "beacon";
export const MODES: Mode[] = ["survival", "duo", "ball", "beacon"];
export const isMode = (v: unknown): v is Mode => MODES.includes(v as Mode);
/** Survival modes have gas, boxes with power cubes, and elimination places. */
export const isSurvival = (mode: Mode) => mode === "survival" || mode === "duo";

export const PLAYER_RADIUS = 26;
export const BULLET_RADIUS = 8;
export const AMMO_MAX = 3;
export const SHOT_COOLDOWN_MS = 320;
export const REGEN_DELAY_MS = 3000;
export const REGEN_PER_SEC = 0.13;
export const SHIELD_MS = 2000;
export const BUSH_REVEAL_DIST = 190;
export const SHOT_REVEAL_MS = 900;
export const HURT_REVEAL_MS = 600;
export const SLOW_FACTOR = 0.55;

export const CUBE_RADIUS = 18;
export const CUBE_DAMAGE = 0.1;
export const CUBE_HP = 400;

export const GAS_START_MS = 20_000;
export const GAS_SHRINK_MS = 85_000;
export const GAS_FROM = 1296;
export const GAS_TO = 170;
export const GAS_DAMAGE = 900;

export const DUO_RESPAWN_MS = 5000;
export const TEAM_RESPAWN_MS = 3000;

export const BALL_RADIUS = 18;
export const KICK_SPEED = 1150;
export const BALL_FRICTION = 1.4; // velocity decays as e^(-k·t)
export const BALL_BOUNCE = 0.6; // a wall bounce keeps 60% of the speed
export const REPICK_MS = 450; // the kicker cannot grab the ball back immediately
export const TACKLE_SHARE = 0.3; // damage taken while carrying that knocks the ball loose
export const TACKLE_LOCK_MS = 800;
export const CARRIER_SPEED = 0.85;
export const GOALS_TO_WIN = 2;
export const GOAL_PAUSE_MS = 1500;

export const BEACON_RADIUS = 150;
export const BEACON_RATE = 0.025; // share of the bar per second of clean hold

// Brawler-specific numbers (docs/design.md, "Бойцы").
const HAMMER_ARC = 0.95;
const JUMP = { range: 520, ms: 500, damage: 1700, radius: 130, knock: 70 };
const SPARK = { pellets: 5, step: 0.11 };
const DASH = { ms: 300, speed: 1350, damage: 1300, knock: 90 };
const BOOMER_SUPER = { spread: 0.3, range: 560, damage: 700 };
const TINKER = { offset: 0.05 };
const TURRET = { hp: 2600, ms: 12_000, range: 520, reloadMs: 550, damage: 290, radius: 24, shotSpeed: 950 };
const SHADE = { offset: 0.08, invisMs: 3500, revealDist: 90, speed: 1.3 };
const BOMB = { flightMs: 550, minRange: 70, radius: 85 };
const CARPET = { offset: 75, delayMs: 70, damage: 1000, radius: 80 };
const BLIZZARD = { slowMs: 1600 };
const STORM = { radius: 150, ms: 4000, tickMs: 500, damage: 330, slowMs: 800 };
const ARROW = { burst: 3, gapMs: 90 };
// Bots are tuned to make survival last about two minutes.
const BOT_AGGRO = 520;
const BOT_FIRE_CHANCE = 0.3;
const BOT_AIM_ERROR = 0.5;
const BOT_FLEE_HP = 0.35;
const VOLLEY = { count: 9, step: 0.06, range: 720, damage: 520 };

export interface Player {
  id: number;
  name: string;
  userId: string | null; // null for bots
  team: number; // survival: own id; duo: 0–2; ball and beacon: 0 blue (bottom), 1 red (top)
  brawler: Brawler;
  level: number;
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
  cubes: number;
  cubesPicked: number;
  alive: boolean;
  /** Knocked out for good (survival modes). */
  out: boolean;
  place: number | null;
  respawnAt: number;
  lastHurtAt: number;
  lastShotAt: number;
  shieldUntil: number;
  slowUntil: number;
  invisUntil: number;
  jump: { from: Vec; to: Vec; start: number; end: number } | null;
  dash: { dx: number; dy: number; end: number; hit: Set<number> } | null;
  burst: { left: number; nextAt: number; angle: number } | null;
  carryDamage: number;
  kills: number;
  deaths: number;
  goals: number;
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

export type ShotKind = "bullet" | "boomerang" | "bomb";

export interface Shot {
  id: number;
  kind: ShotKind;
  ownerId: number;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  rangeLeft: number;
  damage: number;
  pierce: boolean;
  /** Ordinary attacks fill the super; supers and turrets do not. */
  charges: boolean;
  slowMs: number;
  isSuper: boolean;
  /** Ids already hit on this pass (piercing shots and boomerangs). */
  hits: Set<number>;
  returning: boolean;
  bornAt: number;
  // Bombs fly over walls from (sx, sy) to (tx, ty) between t0 and t1.
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t0: number;
  t1: number;
  blast: number;
}

export interface Turret {
  id: number;
  ownerId: number;
  team: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  until: number;
  nextShotAt: number;
  damage: number;
}

export interface Zone {
  id: number;
  ownerId: number;
  team: number;
  x: number;
  y: number;
  r: number;
  until: number;
  nextTickAt: number;
  damage: number;
}

export interface Cube {
  id: number;
  x: number;
  y: number;
}

/** Short-lived visual events: hammer swings, explosions, landings. */
export interface Effect {
  id: number;
  k: "slash" | "boom" | "land";
  x: number;
  y: number;
  r: number;
  a: number;
  time: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  holderId: number | null;
  lastTouchId: number | null;
  kickedAt: number;
  lockId: number | null;
  lockUntil: number;
}

export interface KillEvent {
  time: number;
  killer: string;
  victim: string;
}

export type Result = "win" | "loss" | "draw";

export interface Placement {
  playerId: number;
  userId: string | null;
  name: string;
  brawler: BrawlerId;
  team: number;
  place: number;
  result: Result;
  kills: number;
  deaths: number;
  goals: number;
  cubes: number;
  damage: number;
}

interface Hit {
  owner?: Player;
  charges: boolean;
  slowMs?: number;
  /** Push the target this far away from `from`. */
  knock?: number;
  from?: Vec;
  /** Ignores the spawn shield and jumps (gas). */
  unstoppable?: boolean;
}

const unit = (x: number, y: number): Vec => {
  const d = Math.hypot(x, y) || 1;
  return { x: x / d, y: y / d };
};
const angleDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export class Match {
  time = 0;
  readonly map: ArenaMap;
  readonly players = new Map<number, Player>();
  shots: Shot[] = [];
  turrets: Turret[] = [];
  zones: Zone[] = [];
  cubes: Cube[] = [];
  effects: Effect[] = [];
  kills: KillEvent[] = [];
  ball: Ball | null = null;
  score: [number, number] = [0, 0];
  beacon: [number, number] = [0, 0];
  /** -1 nobody, 0 / 1 a team holds it, 2 contested. */
  beaconState = -1;
  lastGoal: { team: number; scorer: string; time: number } | null = null;
  pausedUntil = 0;
  private nextGasAt = GAS_START_MS;
  private nextId = 1;

  constructor(
    readonly mode: Mode,
    readonly durationMs: number,
    private readonly rng: Rng,
  ) {
    const layout =
      mode === "ball"
        ? BALL_LAYOUT
        : mode === "beacon"
          ? BEACON_LAYOUT
          : SURVIVAL_LAYOUTS[Math.floor(rng() * SURVIVAL_LAYOUTS.length) % SURVIVAL_LAYOUTS.length];
    this.map = new ArenaMap(layout);
    if (mode === "ball") {
      this.resetBall();
      this.pausedUntil = GOAL_PAUSE_MS; // "Приготовьтесь!" before kick-off
    }
  }

  get timeLeftMs() {
    return Math.max(0, this.durationMs - this.time);
  }

  get isPaused() {
    return this.time < this.pausedUntil;
  }

  /** Safe circle radius in survival modes, or null when there is no gas. */
  get gasRadius(): number | null {
    if (!isSurvival(this.mode)) return null;
    const k = Math.min(1, Math.max(0, (this.time - GAS_START_MS) / GAS_SHRINK_MS));
    return GAS_FROM + (GAS_TO - GAS_FROM) * k;
  }

  /** Teams (or solo players) still in a survival match. */
  get teamsLeft(): number {
    return new Set([...this.players.values()].filter((p) => !p.out).map((p) => p.team)).size;
  }

  get isOver(): boolean {
    if (this.time >= this.durationMs) return true;
    if (isSurvival(this.mode)) return this.players.size > 1 && this.teamsLeft <= 1;
    if (this.mode === "ball") return Math.max(...this.score) >= GOALS_TO_WIN;
    return Math.max(...this.beacon) >= 1;
  }

  addPlayer(name: string, brawlerId: BrawlerId, level: number, userId: string | null, team?: number): Player {
    const brawler = BRAWLERS[brawlerId];
    const id = this.nextId++;
    const index = this.players.size;
    const p: Player = {
      id,
      name,
      userId,
      team: this.mode === "survival" ? id : (team ?? 0),
      brawler,
      level,
      color: index,
      x: 0,
      y: 0,
      facing: 0,
      moveX: 0,
      moveY: 0,
      hp: 0,
      maxHp: 0,
      ammo: AMMO_MAX,
      superCharge: 0,
      cubes: 0,
      cubesPicked: 0,
      alive: true,
      out: false,
      place: null,
      respawnAt: 0,
      lastHurtAt: -Infinity,
      lastShotAt: -Infinity,
      shieldUntil: 0,
      slowUntil: 0,
      invisUntil: 0,
      jump: null,
      dash: null,
      burst: null,
      carryDamage: 0,
      kills: 0,
      deaths: 0,
      goals: 0,
      damageDealt: 0,
      bot: userId === null ? newBrain() : undefined,
    };
    p.maxHp = this.maxHpOf(p);
    p.hp = p.maxHp;
    this.players.set(id, p);
    const start = this.startPosition(p);
    p.x = start.x;
    p.y = start.y;
    p.facing = Math.atan2(CENTER - p.y, CENTER - p.x);
    return p;
  }

  /** A player who leaves mid-match is handed to a bot so teams stay full. */
  dropToBot(id: number) {
    const p = this.players.get(id);
    if (!p) return;
    p.userId = null;
    p.bot = newBrain();
  }

  /** Stores a movement direction; any length is clamped to 1. */
  setMove(id: number, mx: number, my: number) {
    const p = this.players.get(id);
    if (!p || !Number.isFinite(mx) || !Number.isFinite(my)) return;
    const len = Math.hypot(mx, my);
    p.moveX = len > 1 ? mx / len : mx;
    p.moveY = len > 1 ? my / len : my;
  }

  /**
   * Main attack, or a kick when holding the ball. The aim vector's direction is where to shoot and its
   * length (0–1) how far to throw (Гром); a zero vector auto-aims at the nearest visible enemy.
   */
  fire(id: number, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !this.canAct(p)) return false;
    if (this.ball?.holderId === id) return this.kick(p, ax, ay);
    if (p.ammo < 1 || this.time - p.lastShotAt < SHOT_COOLDOWN_MS || p.burst) return false;
    const b = p.brawler;
    const aim = this.aim(p, ax, ay, b.range);
    if (!aim) return false;
    p.ammo -= 1;
    p.lastShotAt = this.time;
    p.facing = Math.atan2(aim.dir.y, aim.dir.x);
    const dmg = b.damage * this.damageMult(p);
    const f = p.facing;
    switch (b.id) {
      case "hammer":
        this.swing(p, dmg);
        break;
      case "spark":
        for (let i = 0; i < SPARK.pellets; i++) {
          this.shoot(p, f + (i - (SPARK.pellets - 1) / 2) * SPARK.step, { damage: dmg });
        }
        break;
      case "boomer":
        this.shoot(p, f, { damage: dmg, kind: "boomerang", pierce: true });
        break;
      case "tinker":
        this.shoot(p, f - TINKER.offset, { damage: dmg });
        this.shoot(p, f + TINKER.offset, { damage: dmg });
        break;
      case "shade":
        this.shoot(p, f - SHADE.offset, { damage: dmg });
        this.shoot(p, f + SHADE.offset, { damage: dmg });
        break;
      case "thunder": {
        const d = Math.max(BOMB.minRange, Math.min(b.range, aim.dist));
        this.lob(p, p.x + aim.dir.x * d, p.y + aim.dir.y * d, dmg, BOMB.radius, 0, true);
        break;
      }
      case "blizzard":
        this.shoot(p, f, { damage: dmg, slowMs: BLIZZARD.slowMs });
        break;
      case "arrow":
        this.shoot(p, f, { damage: dmg });
        p.burst = { left: ARROW.burst - 1, nextAt: this.time + ARROW.gapMs, angle: f };
        break;
    }
    return true;
  }

  /** Releases a full super. Aiming works as for `fire`; the ball carrier cannot use it. */
  useSuper(id: number, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !this.canAct(p) || p.superCharge < 1 || this.ball?.holderId === id) return false;
    const b = p.brawler;
    const range = { hammer: JUMP.range, thunder: b.range, blizzard: b.range, spark: DASH.speed * (DASH.ms / 1000) }[b.id as string] ?? b.range;
    const aim = this.aim(p, ax, ay, range);
    if (!aim) return false;
    p.superCharge = 0;
    p.lastShotAt = this.time;
    p.facing = Math.atan2(aim.dir.y, aim.dir.x);
    const mult = this.damageMult(p);
    const f = p.facing;
    const at = (d: number) => ({ x: p.x + aim.dir.x * d, y: p.y + aim.dir.y * d });
    switch (b.id) {
      case "hammer": {
        const to = at(Math.max(BOMB.minRange, aim.dist));
        p.jump = { from: { x: p.x, y: p.y }, to, start: this.time, end: this.time + JUMP.ms };
        break;
      }
      case "spark":
        p.dash = { dx: aim.dir.x, dy: aim.dir.y, end: this.time + DASH.ms, hit: new Set() };
        break;
      case "boomer":
        for (const off of [-BOOMER_SUPER.spread, 0, BOOMER_SUPER.spread]) {
          this.shoot(p, f + off, { damage: BOOMER_SUPER.damage * mult, kind: "boomerang", pierce: true, range: BOOMER_SUPER.range, isSuper: true });
        }
        break;
      case "tinker": {
        this.turrets = this.turrets.filter((t) => t.ownerId !== p.id);
        const spot = this.map.nearestOpen(at(70), TURRET.radius);
        const k = levelMult(p.level);
        this.turrets.push({
          id: this.nextId++,
          ownerId: p.id,
          team: p.team,
          x: spot.x,
          y: spot.y,
          hp: TURRET.hp * k,
          maxHp: TURRET.hp * k,
          until: this.time + TURRET.ms,
          nextShotAt: this.time + TURRET.reloadMs,
          damage: TURRET.damage * mult,
        });
        break;
      }
      case "shade":
        p.invisUntil = this.time + SHADE.invisMs;
        break;
      case "thunder": {
        const c = at(Math.max(BOMB.minRange, aim.dist));
        const spots = [c, { x: c.x + CARPET.offset, y: c.y }, { x: c.x, y: c.y + CARPET.offset }, { x: c.x - CARPET.offset, y: c.y }, { x: c.x, y: c.y - CARPET.offset }];
        spots.forEach((s, i) => this.lob(p, s.x, s.y, CARPET.damage * mult, CARPET.radius, i * CARPET.delayMs, false));
        break;
      }
      case "blizzard": {
        const c = at(aim.dist);
        this.zones.push({
          id: this.nextId++,
          ownerId: p.id,
          team: p.team,
          x: c.x,
          y: c.y,
          r: STORM.radius,
          until: this.time + STORM.ms,
          nextTickAt: this.time,
          damage: STORM.damage * mult,
        });
        break;
      }
      case "arrow":
        for (let i = 0; i < VOLLEY.count; i++) {
          this.shoot(p, f + (i - (VOLLEY.count - 1) / 2) * VOLLEY.step, {
            damage: VOLLEY.damage * mult,
            range: VOLLEY.range,
            pierce: true,
            isSuper: true,
          });
        }
        break;
    }
    return true;
  }

  step(dtMs: number) {
    this.time += dtMs;
    if (this.isPaused || this.isOver) return;
    const dt = dtMs / 1000;
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (!p.out && this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      if (p.bot) this.think(p);
      this.movePlayer(p, dt);
      if (p.burst && this.time >= p.burst.nextAt) {
        this.shoot(p, p.burst.angle, { damage: p.brawler.damage * this.damageMult(p) });
        p.burst.left -= 1;
        p.burst.nextAt = this.time + ARROW.gapMs;
        if (p.burst.left <= 0) p.burst = null;
      }
      if (p.ammo < AMMO_MAX) p.ammo = Math.min(AMMO_MAX, p.ammo + dtMs / p.brawler.reloadMs);
      if (this.time - Math.max(p.lastHurtAt, p.lastShotAt) >= REGEN_DELAY_MS) {
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * REGEN_PER_SEC * dt);
      }
    }
    this.separatePlayers();
    this.pickCubes();
    this.moveShots(dt);
    this.runTurrets();
    this.runZones();
    if (this.mode === "ball") this.moveBall(dt);
    if (this.mode === "beacon") this.holdBeacon(dt);
    this.applyGas();
    this.effects = this.effects.filter((e) => this.time - e.time < 400);
    if (this.isOver) this.finalizePlaces();
  }

  /** Whether `viewer` can currently see `target`: bushes and invisibility hide enemies. */
  canSee(viewer: { team: number; x: number; y: number }, target: Player): boolean {
    if (viewer.team === target.team || this.ball?.holderId === target.id) return true;
    const d = Math.hypot(viewer.x - target.x, viewer.y - target.y);
    if (this.time < target.invisUntil) return d < SHADE.revealDist;
    if (!this.map.isBush(target.x, target.y)) return true;
    if (this.time - target.lastShotAt < SHOT_REVEAL_MS || this.time - target.lastHurtAt < HURT_REVEAL_MS) return true;
    return d < BUSH_REVEAL_DIST;
  }

  /** A player's final result once it is known (knocked out in survival modes, or the match ended). */
  placementOf(id: number): Placement | null {
    const p = this.players.get(id);
    if (!p) return null;
    if (this.isOver) return this.results().find((r) => r.playerId === id) ?? null;
    if (p.out && p.place !== null) return this.placement(p, p.place, "loss");
    return null;
  }

  results(): Placement[] {
    this.finalizePlaces();
    const all = [...this.players.values()];
    if (isSurvival(this.mode)) {
      return all
        .sort((a, b) => a.place! - b.place! || b.kills - a.kills)
        .map((p) => this.placement(p, p.place!, p.place === 1 ? "win" : "loss"));
    }
    const [a, b] = this.mode === "ball" ? this.score : this.beacon;
    const winner = a === b ? null : a > b ? 0 : 1;
    const resultOf = (p: Player): Result => (winner === null ? "draw" : p.team === winner ? "win" : "loss");
    return all
      .sort((x, y) => +(resultOf(y) === "win") - +(resultOf(x) === "win") || y.goals - x.goals || y.kills - x.kills || y.damageDealt - x.damageDealt)
      .map((p) => this.placement(p, resultOf(p) === "loss" ? 2 : 1, resultOf(p)));
  }

  goalCenter(team: number): Vec {
    const g = goalRect(team);
    return { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2 };
  }

  maxHpOf(p: Player): number {
    const k = levelMult(p.level);
    return Math.round(p.brawler.hp * k + CUBE_HP * k * p.cubes);
  }

  damageMult(p: Player): number {
    return levelMult(p.level) * (1 + CUBE_DAMAGE * p.cubes);
  }

  // ---- places and results ----

  private placement(p: Player, place: number, result: Result): Placement {
    return {
      playerId: p.id,
      userId: p.userId,
      name: p.name,
      brawler: p.brawler.id,
      team: p.team,
      place,
      result,
      kills: p.kills,
      deaths: p.deaths,
      goals: p.goals,
      cubes: p.cubesPicked,
      damage: Math.round(p.damageDealt),
    };
  }

  /** At the end, gives places to everyone still in: healthiest team first (only matters at the time cap). */
  private finalizePlaces() {
    if (!isSurvival(this.mode)) return;
    const teams = new Map<number, Player[]>();
    for (const p of this.players.values()) if (!p.out) teams.set(p.team, [...(teams.get(p.team) ?? []), p]);
    const ranked = [...teams.values()].sort(
      (a, b) => b.reduce((s, p) => s + (p.alive ? p.hp : 0), 0) - a.reduce((s, p) => s + (p.alive ? p.hp : 0), 0),
    );
    ranked.forEach((members, i) => members.forEach((p) => (p.place = i + 1)));
  }

  // ---- combat ----

  private canAct(p: Player) {
    return p.alive && !this.isPaused && !this.isOver && !p.jump && !p.dash;
  }

  private aim(p: Player, ax: number, ay: number, range: number): { dir: Vec; dist: number } | null {
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return null;
    const len = Math.hypot(ax, ay);
    if (len > 0.01) return { dir: { x: ax / len, y: ay / len }, dist: Math.min(1, len) * range };
    const target = this.nearestEnemy(p, range + 80);
    if (target) {
      const d = Math.hypot(target.x - p.x, target.y - p.y);
      return { dir: unit(target.x - p.x, target.y - p.y), dist: Math.min(range, d) };
    }
    return { dir: { x: Math.cos(p.facing), y: Math.sin(p.facing) }, dist: range * 0.7 };
  }

  private shoot(
    p: Player,
    angle: number,
    o: { damage: number; kind?: ShotKind; pierce?: boolean; range?: number; slowMs?: number; isSuper?: boolean },
  ) {
    const speed = p.brawler.shotSpeed || 900;
    this.shots.push(this.makeShot(p.id, p.team, p.x, p.y, angle, speed, o.range ?? p.brawler.range, o.damage, {
      kind: o.kind ?? "bullet",
      pierce: o.pierce ?? false,
      charges: !o.isSuper,
      slowMs: o.slowMs ?? 0,
      isSuper: o.isSuper ?? false,
    }));
  }

  private makeShot(
    ownerId: number,
    team: number,
    x: number,
    y: number,
    angle: number,
    speed: number,
    range: number,
    damage: number,
    o: { kind: ShotKind; pierce: boolean; charges: boolean; slowMs: number; isSuper: boolean },
  ): Shot {
    return {
      id: this.nextId++,
      ownerId,
      team,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed,
      rangeLeft: range,
      damage,
      hits: new Set(),
      returning: false,
      bornAt: this.time,
      sx: x,
      sy: y,
      tx: x,
      ty: y,
      t0: this.time,
      t1: this.time,
      blast: 0,
      ...o,
    };
  }

  /** A bomb that arcs over walls and explodes at (tx, ty). */
  private lob(p: Player, tx: number, ty: number, damage: number, blast: number, delayMs: number, charges: boolean) {
    const shot = this.makeShot(p.id, p.team, p.x, p.y, 0, 0, 0, damage, { kind: "bomb", pierce: true, charges, slowMs: 0, isSuper: !charges });
    Object.assign(shot, { tx, ty, t0: this.time + delayMs, t1: this.time + delayMs + BOMB.flightMs, blast });
    this.shots.push(shot);
  }

  /** Кувалда: everyone in the sector in front takes the hit, boxes included. */
  private swing(p: Player, damage: number) {
    const r = p.brawler.range;
    this.effects.push({ id: this.nextId++, k: "slash", x: p.x, y: p.y, r, a: p.facing, time: this.time });
    const inArc = (x: number, y: number, radius: number) => {
      const d = Math.hypot(x - p.x, y - p.y);
      if (d > r + radius) return false;
      return d < radius + PLAYER_RADIUS || angleDiff(Math.atan2(y - p.y, x - p.x), p.facing) <= HAMMER_ARC;
    };
    for (const t of this.players.values()) {
      if (t.team === p.team || !t.alive || !inArc(t.x, t.y, PLAYER_RADIUS)) continue;
      if (!this.map.lineOfSight(p.x, p.y, t.x, t.y)) continue;
      this.damagePlayer(t, damage, { owner: p, charges: true });
    }
    for (const t of [...this.turrets]) {
      if (t.team !== p.team && inArc(t.x, t.y, TURRET.radius)) this.damageTurret(t, damage);
    }
    const cx = p.x + Math.cos(p.facing) * r * 0.55;
    const cy = p.y + Math.sin(p.facing) * r * 0.55;
    for (const index of this.map.boxesInCircle(cx, cy, r * 0.55)) this.damageBox(index, damage);
  }

  private damageBox(index: number, damage: number) {
    if (this.map.damageBox(index, damage)) {
      const c = this.map.boxCenter(index);
      this.cubes.push({ id: this.nextId++, x: c.x, y: c.y });
    }
  }

  private damageTurret(t: Turret, damage: number) {
    t.hp -= damage;
    if (t.hp <= 0) this.turrets = this.turrets.filter((o) => o !== t);
  }

  /** Applies damage to a brawler; returns the damage actually dealt. */
  private damagePlayer(target: Player, amount: number, hit: Hit): number {
    if (!target.alive || (!hit.unstoppable && (target.jump || this.time < target.shieldUntil))) return 0;
    const dealt = Math.min(target.hp, amount);
    target.hp -= dealt;
    target.lastHurtAt = this.time;
    const owner = hit.owner;
    if (owner) {
      owner.damageDealt += dealt;
      if (hit.charges) owner.superCharge = Math.min(1, owner.superCharge + 1 / owner.brawler.hitsToSuper);
    }
    if (hit.slowMs) target.slowUntil = Math.max(target.slowUntil, this.time + hit.slowMs);
    if (hit.knock && hit.from) {
      const dir = unit(target.x - hit.from.x, target.y - hit.from.y);
      const pos = this.map.resolveWalls(target.x + dir.x * hit.knock, target.y + dir.y * hit.knock, PLAYER_RADIUS);
      target.x = pos.x;
      target.y = pos.y;
    }
    if (this.ball?.holderId === target.id && owner) {
      target.carryDamage += dealt;
      if (target.carryDamage >= target.maxHp * TACKLE_SHARE) this.tackle(target, owner);
    }
    if (target.hp <= 0) this.knockOut(target, owner);
    return dealt;
  }

  private knockOut(target: Player, owner?: Player) {
    if (this.ball?.holderId === target.id) this.dropBall();
    target.alive = false;
    target.deaths += 1;
    target.moveX = 0;
    target.moveY = 0;
    target.jump = null;
    target.dash = null;
    target.burst = null;
    target.invisUntil = 0;
    this.turrets = this.turrets.filter((t) => t.ownerId !== target.id);
    if (owner && owner.team !== target.team) owner.kills += 1;
    this.kills.push({ time: this.time, killer: owner?.name ?? "Газ", victim: target.name });
    if (this.kills.length > 20) this.kills.shift();

    if (isSurvival(this.mode)) {
      // Knocked-out brawlers drop all their cubes, at least one.
      const n = Math.max(1, target.cubes);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.rng();
        const spot = this.map.nearestOpen({ x: target.x + Math.cos(a) * 30 * Math.min(1, i), y: target.y + Math.sin(a) * 30 * Math.min(1, i) }, CUBE_RADIUS);
        this.cubes.push({ id: this.nextId++, x: spot.x, y: spot.y });
      }
      target.cubes = 0;
    }
    if (this.mode === "survival") {
      this.eliminate([target]);
    } else if (this.mode === "duo") {
      const partner = [...this.players.values()].find((o) => o.team === target.team && o.id !== target.id);
      if (partner && partner.alive) target.respawnAt = this.time + DUO_RESPAWN_MS;
      else this.eliminate([target, ...(partner ? [partner] : [])]);
    } else {
      target.respawnAt = this.time + TEAM_RESPAWN_MS;
    }
  }

  /** Knocks a team out of a survival match; its place is the number of teams left plus one. */
  private eliminate(team: Player[]) {
    for (const p of team) p.out = true;
    const place = this.teamsLeft + 1;
    for (const p of team) p.place = place;
  }

  private respawn(p: Player) {
    let spot: Vec;
    if (this.mode === "duo") {
      const partner = [...this.players.values()].find((o) => o.team === p.team && o.id !== p.id && o.alive);
      if (!partner) return;
      spot = this.map.nearestOpen({ x: partner.x + 50, y: partner.y }, PLAYER_RADIUS);
    } else {
      spot = this.startPosition(p);
    }
    p.x = spot.x;
    p.y = spot.y;
    p.maxHp = this.maxHpOf(p);
    p.hp = p.maxHp;
    p.ammo = AMMO_MAX;
    p.alive = true;
    p.slowUntil = 0;
    p.lastHurtAt = -Infinity;
    p.shieldUntil = this.time + SHIELD_MS;
  }

  private startPosition(p: Player): Vec {
    const order = [...this.players.values()].filter((o) => o.team === p.team);
    const slot = Math.max(0, order.indexOf(p));
    if (this.mode === "survival") return SURVIVAL_SPAWNS[p.color % SURVIVAL_SPAWNS.length];
    if (this.mode === "duo") return SURVIVAL_SPAWNS[(p.team * 2 + slot) % SURVIVAL_SPAWNS.length];
    const spawns = TEAM_SPAWNS[p.team === 1 ? 1 : 0];
    return spawns[slot % spawns.length];
  }

  private nearestEnemy(p: Player, maxDist: number): Player | null {
    let best: Player | null = null;
    let bestD = maxDist;
    for (const o of this.players.values()) {
      if (o.team === p.team || !o.alive || !this.canSee(p, o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  // ---- movement ----

  private movePlayer(p: Player, dt: number) {
    if (p.jump) {
      const j = p.jump;
      const k = Math.min(1, (this.time - j.start) / (j.end - j.start));
      p.x = j.from.x + (j.to.x - j.from.x) * k;
      p.y = j.from.y + (j.to.y - j.from.y) * k;
      if (k >= 1) this.land(p);
      return;
    }
    if (p.dash) {
      const d = p.dash;
      const step = DASH.speed * dt;
      const want = { x: p.x + d.dx * step, y: p.y + d.dy * step };
      for (const index of this.map.boxesInCircle(want.x, want.y, PLAYER_RADIUS + 4)) this.damageBox(index, Infinity);
      const pos = this.map.resolveWalls(want.x, want.y, PLAYER_RADIUS);
      const blocked = Math.hypot(pos.x - want.x, pos.y - want.y) > step * 0.5;
      p.x = pos.x;
      p.y = pos.y;
      for (const t of this.players.values()) {
        if (t.team === p.team || !t.alive || d.hit.has(t.id)) continue;
        if (Math.hypot(t.x - p.x, t.y - p.y) <= PLAYER_RADIUS * 2) {
          d.hit.add(t.id);
          this.damagePlayer(t, DASH.damage * this.damageMult(p), { owner: p, charges: false, knock: DASH.knock, from: { x: p.x, y: p.y } });
        }
      }
      if (blocked || this.time >= d.end) p.dash = null;
      return;
    }
    if (!p.moveX && !p.moveY) return;
    let speed = p.brawler.speed;
    if (this.time < p.slowUntil) speed *= SLOW_FACTOR;
    if (this.time < p.invisUntil) speed *= SHADE.speed;
    if (this.ball?.holderId === p.id) speed *= CARRIER_SPEED;
    const pos = this.map.resolveWalls(p.x + p.moveX * speed * dt, p.y + p.moveY * speed * dt, PLAYER_RADIUS);
    p.x = pos.x;
    p.y = pos.y;
    if (this.time - p.lastShotAt > 400 && !p.burst) p.facing = Math.atan2(p.moveY, p.moveX);
  }

  /** Кувалда lands: damage and knockback around the landing spot. */
  private land(p: Player) {
    p.jump = null;
    const spot = this.map.nearestOpen({ x: p.x, y: p.y }, PLAYER_RADIUS);
    p.x = spot.x;
    p.y = spot.y;
    const damage = JUMP.damage * this.damageMult(p);
    this.effects.push({ id: this.nextId++, k: "land", x: p.x, y: p.y, r: JUMP.radius, a: 0, time: this.time });
    for (const t of this.players.values()) {
      if (t.team === p.team || !t.alive) continue;
      if (Math.hypot(t.x - p.x, t.y - p.y) <= JUMP.radius + PLAYER_RADIUS / 2) {
        this.damagePlayer(t, damage, { owner: p, charges: false, knock: JUMP.knock, from: { x: p.x, y: p.y } });
      }
    }
    for (const t of [...this.turrets]) if (t.team !== p.team && Math.hypot(t.x - p.x, t.y - p.y) <= JUMP.radius) this.damageTurret(t, damage);
    for (const index of this.map.boxesInCircle(p.x, p.y, JUMP.radius)) this.damageBox(index, damage);
  }

  /** Brawlers push each other apart. */
  private separatePlayers() {
    const list = [...this.players.values()].filter((p) => p.alive && !p.jump);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const overlap = PLAYER_RADIUS * 2 - d;
        if (overlap <= 0) continue;
        const u = d > 0 ? { x: dx / d, y: dy / d } : { x: 1, y: 0 };
        const pa = this.map.resolveWalls(a.x - (u.x * overlap) / 2, a.y - (u.y * overlap) / 2, PLAYER_RADIUS);
        const pb = this.map.resolveWalls(b.x + (u.x * overlap) / 2, b.y + (u.y * overlap) / 2, PLAYER_RADIUS);
        Object.assign(a, pa);
        Object.assign(b, pb);
      }
    }
  }

  private pickCubes() {
    if (this.cubes.length === 0) return;
    for (const p of this.players.values()) {
      if (!p.alive || p.jump) continue;
      for (const c of this.cubes) {
        if (Math.hypot(c.x - p.x, c.y - p.y) > PLAYER_RADIUS + CUBE_RADIUS) continue;
        this.cubes = this.cubes.filter((o) => o !== c);
        const k = levelMult(p.level);
        p.cubes += 1;
        p.cubesPicked += 1;
        p.maxHp = this.maxHpOf(p);
        p.hp = Math.min(p.maxHp, p.hp + CUBE_HP * k);
        break;
      }
    }
  }

  // ---- projectiles, turrets, zones, gas ----

  private moveShots(dt: number) {
    const survivors: Shot[] = [];
    for (const s of this.shots) if (this.moveShot(s, dt)) survivors.push(s);
    // Shots spawned during the loop (none today) would be appended after.
    this.shots = survivors;
  }

  /** Advances one shot; returns false when it is gone. */
  private moveShot(s: Shot, dt: number): boolean {
    const owner = this.players.get(s.ownerId);
    if (s.kind === "bomb") {
      if (this.time < s.t1) {
        const k = Math.max(0, (this.time - s.t0) / (s.t1 - s.t0));
        s.x = s.sx + (s.tx - s.sx) * k;
        s.y = s.sy + (s.ty - s.sy) * k;
        return true;
      }
      this.explode(s, owner);
      return false;
    }
    if (s.kind === "boomerang" && s.returning) {
      if (!owner || !owner.alive || this.time - s.bornAt > 4000) return false;
      const dir = unit(owner.x - s.x, owner.y - s.y);
      s.vx = dir.x * s.speed;
      s.vy = dir.y * s.speed;
      if (Math.hypot(owner.x - s.x, owner.y - s.y) < PLAYER_RADIUS) return false;
    }
    const dist = s.speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 20));
    for (let i = 0; i < steps; i++) {
      s.x += (s.vx * dt) / steps;
      s.y += (s.vy * dt) / steps;
      if (!s.returning) {
        s.rangeLeft -= dist / steps;
        const box = this.map.boxIndexAt(s.x, s.y);
        const blocked = this.map.isSolid(s.x, s.y);
        if (blocked && box !== null) this.damageBox(box, s.damage);
        if (s.rangeLeft <= 0 || blocked) {
          if (s.kind !== "boomerang") return false;
          if (blocked) {
            s.x -= (s.vx * dt) / steps;
            s.y -= (s.vy * dt) / steps;
          }
          s.returning = true;
          s.hits.clear();
          return true;
        }
      }
      for (const t of this.players.values()) {
        if (t.team === s.team || !t.alive || t.jump || s.hits.has(t.id)) continue;
        if (Math.hypot(t.x - s.x, t.y - s.y) > PLAYER_RADIUS + BULLET_RADIUS) continue;
        s.hits.add(t.id);
        this.damagePlayer(t, s.damage, { owner, charges: s.charges, slowMs: s.slowMs });
        if (!s.pierce) return false;
      }
      for (const t of [...this.turrets]) {
        if (t.team === s.team || s.hits.has(t.id)) continue;
        if (Math.hypot(t.x - s.x, t.y - s.y) > TURRET.radius + BULLET_RADIUS) continue;
        s.hits.add(t.id);
        this.damageTurret(t, s.damage);
        if (!s.pierce) return false;
      }
    }
    return true;
  }

  private explode(s: Shot, owner?: Player) {
    this.effects.push({ id: this.nextId++, k: "boom", x: s.tx, y: s.ty, r: s.blast, a: 0, time: this.time });
    for (const t of this.players.values()) {
      if (t.team === s.team || !t.alive) continue;
      if (Math.hypot(t.x - s.tx, t.y - s.ty) <= s.blast + PLAYER_RADIUS / 2) this.damagePlayer(t, s.damage, { owner, charges: s.charges });
    }
    for (const t of [...this.turrets]) if (t.team !== s.team && Math.hypot(t.x - s.tx, t.y - s.ty) <= s.blast + TURRET.radius / 2) this.damageTurret(t, s.damage);
    for (const index of this.map.boxesInCircle(s.tx, s.ty, s.blast)) this.damageBox(index, s.damage);
  }

  private runTurrets() {
    this.turrets = this.turrets.filter((t) => this.time < t.until);
    for (const t of this.turrets) {
      if (this.time < t.nextShotAt) continue;
      let best: Player | null = null;
      let bestD = TURRET.range;
      for (const o of this.players.values()) {
        if (o.team === t.team || !o.alive || !this.canSee(t, o)) continue;
        const d = Math.hypot(o.x - t.x, o.y - t.y);
        if (d < bestD && this.map.lineOfSight(t.x, t.y, o.x, o.y)) {
          best = o;
          bestD = d;
        }
      }
      if (!best) continue;
      t.nextShotAt = this.time + TURRET.reloadMs;
      const angle = Math.atan2(best.y - t.y, best.x - t.x);
      this.shots.push(this.makeShot(t.ownerId, t.team, t.x, t.y, angle, TURRET.shotSpeed, TURRET.range, t.damage, {
        kind: "bullet",
        pierce: false,
        charges: false,
        slowMs: 0,
        isSuper: false,
      }));
    }
  }

  private runZones() {
    this.zones = this.zones.filter((z) => this.time < z.until);
    for (const z of this.zones) {
      if (this.time < z.nextTickAt) continue;
      z.nextTickAt += STORM.tickMs;
      const owner = this.players.get(z.ownerId);
      for (const t of this.players.values()) {
        if (t.team === z.team || !t.alive) continue;
        if (Math.hypot(t.x - z.x, t.y - z.y) <= z.r) this.damagePlayer(t, z.damage, { owner, charges: false, slowMs: STORM.slowMs });
      }
    }
  }

  private applyGas() {
    const r = this.gasRadius;
    if (r === null || this.time < this.nextGasAt) return;
    this.nextGasAt += 1000;
    for (const p of this.players.values()) {
      if (p.alive && Math.hypot(p.x - CENTER, p.y - CENTER) > r) {
        // Gas ignores the spawn shield and jumps: nobody waits it out.
        this.damagePlayer(p, GAS_DAMAGE, { charges: false, unstoppable: true });
      }
    }
  }

  // ---- beacon ----

  private holdBeacon(dt: number) {
    const inside = new Set<number>();
    for (const p of this.players.values()) {
      if (p.alive && Math.hypot(p.x - CENTER, p.y - CENTER) <= BEACON_RADIUS) inside.add(p.team);
    }
    if (inside.size === 0) this.beaconState = -1;
    else if (inside.size > 1) this.beaconState = 2;
    else {
      const team = [...inside][0];
      this.beaconState = team;
      this.beacon[team] = Math.min(1, this.beacon[team] + BEACON_RATE * dt);
    }
  }

  // ---- ball ----

  private resetBall() {
    this.ball = { x: CENTER, y: CENTER, vx: 0, vy: 0, holderId: null, lastTouchId: null, kickedAt: -Infinity, lockId: null, lockUntil: 0 };
  }

  private dropBall() {
    const ball = this.ball!;
    ball.holderId = null;
    ball.vx = 0;
    ball.vy = 0;
  }

  /** The carrier took too much damage: the ball flies away from the attacker. */
  private tackle(carrier: Player, attacker: Player) {
    const ball = this.ball!;
    const dir = unit(carrier.x - attacker.x, carrier.y - attacker.y);
    ball.holderId = null;
    ball.vx = dir.x * 600;
    ball.vy = dir.y * 600;
    ball.lockId = carrier.id;
    ball.lockUntil = this.time + TACKLE_LOCK_MS;
    carrier.carryDamage = 0;
  }

  private kick(p: Player, ax: number, ay: number): boolean {
    const ball = this.ball!;
    const len = Math.hypot(ax, ay);
    // A tap kicks straight at the opponents' goal.
    const goal = this.goalCenter(1 - p.team);
    const dir = len > 0.01 && Number.isFinite(len) ? { x: ax / len, y: ay / len } : unit(goal.x - p.x, goal.y - p.y);
    ball.holderId = null;
    ball.vx = dir.x * KICK_SPEED;
    ball.vy = dir.y * KICK_SPEED;
    ball.kickedAt = this.time;
    ball.lastTouchId = p.id;
    p.facing = Math.atan2(dir.y, dir.x);
    p.lastShotAt = this.time;
    return true;
  }

  private moveBall(dt: number) {
    const ball = this.ball!;
    const holder = ball.holderId !== null ? this.players.get(ball.holderId) : undefined;
    if (holder) {
      const reach = PLAYER_RADIUS + BALL_RADIUS - 6;
      const pos = this.map.resolveWalls(holder.x + Math.cos(holder.facing) * reach, holder.y + Math.sin(holder.facing) * reach, BALL_RADIUS);
      ball.x = pos.x;
      ball.y = pos.y;
    } else {
      const steps = Math.max(1, Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / 12));
      for (let i = 0; i < steps; i++) {
        const nx = ball.x + (ball.vx * dt) / steps;
        const ny = ball.y + (ball.vy * dt) / steps;
        // Bounce off walls axis by axis, losing 40% of the speed.
        if (this.ballTouchesWall(nx, ball.y)) ball.vx = -ball.vx * BALL_BOUNCE;
        else ball.x = nx;
        if (this.ballTouchesWall(ball.x, ny)) ball.vy = -ball.vy * BALL_BOUNCE;
        else ball.y = ny;
      }
      const decay = Math.exp(-BALL_FRICTION * dt);
      ball.vx *= decay;
      ball.vy *= decay;
      if (Math.hypot(ball.vx, ball.vy) < 30) {
        ball.vx = 0;
        ball.vy = 0;
      }
      for (const p of this.players.values()) {
        if (!p.alive || p.jump) continue;
        if (p.id === ball.lastTouchId && this.time - ball.kickedAt < REPICK_MS) continue;
        if (p.id === ball.lockId && this.time < ball.lockUntil) continue;
        if (Math.hypot(p.x - ball.x, p.y - ball.y) <= PLAYER_RADIUS + BALL_RADIUS) {
          ball.holderId = p.id;
          ball.lastTouchId = p.id;
          ball.vx = 0;
          ball.vy = 0;
          p.carryDamage = 0;
          break;
        }
      }
    }
    for (const team of [0, 1]) {
      const g = goalRect(team);
      if (ball.x >= g.x0 && ball.x <= g.x1 && ball.y >= g.y0 && ball.y <= g.y1) {
        this.goal(1 - team);
        return;
      }
    }
  }

  private ballTouchesWall(x: number, y: number): boolean {
    return [
      [x - BALL_RADIUS, y],
      [x + BALL_RADIUS, y],
      [x, y - BALL_RADIUS],
      [x, y + BALL_RADIUS],
    ].some(([px, py]) => this.map.isSolid(px, py));
  }

  private goal(team: number) {
    this.score[team] += 1;
    const scorer = this.ball!.lastTouchId !== null ? this.players.get(this.ball!.lastTouchId) : undefined;
    if (scorer && scorer.team === team) scorer.goals += 1;
    this.lastGoal = { team, scorer: scorer?.name ?? "", time: this.time };
    this.resetBall();
    this.shots = [];
    this.turrets = [];
    this.zones = [];
    this.pausedUntil = this.time + GOAL_PAUSE_MS;
    // Kick-off: everyone back to the start, full health.
    for (const p of this.players.values()) {
      const s = this.startPosition(p);
      Object.assign(p, { x: s.x, y: s.y, alive: true, ammo: AMMO_MAX, moveX: 0, moveY: 0, jump: null, dash: null, burst: null, slowUntil: 0 });
      p.hp = p.maxHp;
    }
  }

  // ---- bots ----

  private think(p: Player) {
    const brain = p.bot!;
    if (this.time < brain.nextThinkAt || p.jump || p.dash) return;
    brain.nextThinkAt = this.time + 100 + this.rng() * 100;
    this.decide(p);
    brain.lastX = p.x;
    brain.lastY = p.y;
  }

  private decide(p: Player) {
    if (this.mode === "ball" && this.thinkBall(p)) return;
    const gas = this.gasRadius;
    const target = this.nearestEnemy(p, BOT_AGGRO);
    if (gas !== null && Math.hypot(p.x - CENTER, p.y - CENTER) > gas - 120) {
      // Get out of the gas first, still shooting on the way.
      this.goTo(p, { x: CENTER, y: CENTER });
      if (target) this.shootAt(p, target);
      return;
    }
    if (target && p.hp < p.maxHp * BOT_FLEE_HP && this.mode !== "beacon") {
      // Hurt bots back off to heal, which keeps survival from ending in seconds.
      this.goTo(p, { x: p.x - (target.x - p.x), y: p.y - (target.y - p.y) });
      return;
    }
    if (target) return this.fight(p, target, true);
    if (this.mode === "beacon") {
      return this.goTo(p, { x: CENTER + (this.rng() - 0.5) * 120, y: CENTER + (this.rng() - 0.5) * 120 });
    }
    const cube = this.cubes.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 600);
    if (cube) return this.goTo(p, cube);
    const box = [...this.map.boxes.keys()]
      .map((i) => this.map.boxCenter(i))
      .find((b) => {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        // Aim at the near face of the box so the box itself does not block the check.
        return d < 500 && this.map.lineOfSight(p.x, p.y, b.x - ((b.x - p.x) / d) * 40, b.y - ((b.y - p.y) / d) * 40);
      });
    if (box) {
      const d = Math.hypot(box.x - p.x, box.y - p.y);
      const reach = Math.min(p.brawler.range, 400) * 0.8;
      if (d > reach) this.goTo(p, box);
      else {
        this.setMove(p.id, 0, 0);
        if (this.rng() < 0.5) this.fire(p.id, (box.x - p.x) / p.brawler.range, (box.y - p.y) / p.brawler.range);
      }
      return;
    }
    this.wander(p);
  }

  /** Ball decisions; returns false to fall back to plain fighting. */
  private thinkBall(p: Player): boolean {
    const ball = this.ball!;
    if (ball.holderId === p.id) {
      const goal = this.goalCenter(1 - p.team);
      const d = Math.hypot(goal.x - p.x, goal.y - p.y);
      if (d < 450 && this.map.lineOfSight(p.x, p.y, goal.x, goal.y)) {
        const a = Math.atan2(goal.y - p.y, goal.x - p.x) + (this.rng() - 0.5) * 0.2;
        this.fire(p.id, Math.cos(a), Math.sin(a));
      } else {
        this.goTo(p, goal);
      }
      return true;
    }
    const holder = ball.holderId !== null ? this.players.get(ball.holderId) : undefined;
    if (holder && holder.team !== p.team) {
      this.fight(p, holder, false); // chase and shoot the carrier
      return true;
    }
    // The last bot of a team stays back as a goalkeeper unless its own team has the ball.
    const keeper = [...this.players.values()].filter((o) => o.team === p.team && o.bot && o.alive).pop();
    if (keeper?.id === p.id && holder?.team !== p.team) {
      const own = this.goalCenter(p.team);
      const dir = unit(ball.x - own.x, ball.y - own.y);
      const spot = { x: own.x + dir.x * 200, y: own.y + dir.y * 200 };
      const dist = Math.hypot(spot.x - p.x, spot.y - p.y);
      this.setMove(p.id, dist > 20 ? spot.x - p.x : 0, dist > 20 ? spot.y - p.y : 0);
      const threat = this.nearestEnemy(p, p.brawler.range);
      if (threat) this.shootAt(p, threat);
      return true;
    }
    if (!holder) {
      const mates = [...this.players.values()].filter((o) => o.team === p.team && o.alive && o.id !== keeper?.id);
      const chaser = mates.sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
      if (chaser?.id === p.id) {
        this.goTo(p, ball);
        return true;
      }
    }
    return false;
  }

  /** Keeps the brawler's preferred distance, circles the target, shoots and uses the super. */
  private fight(p: Player, target: Player, keepDistance: boolean) {
    const brain = p.bot!;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    const range = p.brawler.range;
    if (this.rng() < 0.05) brain.strafe = -brain.strafe;
    const far = range * 0.85;
    const near = range * 0.5;
    const toward = !keepDistance || range < 250 ? (d > Math.min(range * 0.7, 140) ? 1 : 0) : d > far ? 1 : d < near ? -1 : 0;
    this.setMove(p.id, ux * toward - uy * brain.strafe * 0.7, uy * toward + ux * brain.strafe * 0.7);
    if (this.ball?.holderId === p.id) return;
    const sees = p.brawler.id === "thunder" || this.map.lineOfSight(p.x, p.y, target.x, target.y);
    const superReach = { hammer: 500, spark: 380, shade: 600, tinker: 520, thunder: 470, blizzard: 560, boomer: 540, arrow: 680 }[p.brawler.id];
    if (sees && p.superCharge >= 1 && d < superReach) {
      const k = 1 / Math.max(1, superReach);
      this.useSuper(p.id, dx * k, dy * k);
    } else {
      this.shootAt(p, target);
    }
  }

  private shootAt(p: Player, target: Player) {
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    const range = p.brawler.range;
    if (d > range + 20 || this.rng() > BOT_FIRE_CHANCE) return;
    if (p.brawler.id !== "thunder" && !this.map.lineOfSight(p.x, p.y, target.x, target.y)) return;
    const a = Math.atan2(dy, dx) + (this.rng() - 0.5) * BOT_AIM_ERROR;
    const len = p.brawler.id === "thunder" ? Math.min(1, d / range) : 1;
    this.fire(p.id, Math.cos(a) * len, Math.sin(a) * len);
  }

  /** Walks toward a point, sliding sideways when stuck on a wall. */
  private goTo(p: Player, to: Vec) {
    const brain = p.bot!;
    const dir = unit(to.x - p.x, to.y - p.y);
    const stuck = Math.hypot(p.x - brain.lastX, p.y - brain.lastY) < 2;
    this.setMove(p.id, dir.x + (stuck ? -dir.y * brain.strafe : 0), dir.y + (stuck ? dir.x * brain.strafe : 0));
  }

  private wander(p: Player) {
    const brain = p.bot!;
    const stuck = Math.hypot(p.x - brain.lastX, p.y - brain.lastY) < 2;
    if (!brain.wander || stuck || Math.hypot(brain.wander.x - p.x, brain.wander.y - p.y) < 40) {
      const r = Math.min(600, (this.gasRadius ?? 700) - 150);
      const a = this.rng() * Math.PI * 2;
      const d = this.rng() * Math.max(100, r);
      brain.wander = { x: CENTER + Math.cos(a) * d, y: CENTER + Math.sin(a) * d };
    }
    this.setMove(p.id, brain.wander.x - p.x, brain.wander.y - p.y);
  }
}

function newBrain(): BotBrain {
  return { wander: null, strafe: 1, nextThinkAt: 0, lastX: 0, lastY: 0 };
}
