// Authoritative real-time arena simulation. Pure state + fixed steps, no timers or sockets,
// so the server loop and the tests drive it the same way.
import { maxHpFor, type Stats } from "../game/progression.js";
import { BRAWL_MAP, FOOTBALL_MAP, type ArenaMap } from "./map.js";

export type Rng = () => number;
export type Mode = "brawl" | "football";
export const MODES: Mode[] = ["brawl", "football"];
export type Weapon = "rifle" | "shotgun";
export const WEAPONS: Weapon[] = ["rifle", "shotgun"];

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

export const BALL_RADIUS = 18;
export const KICK_SPEED = 1100;
export const SUPER_KICK_SPEED = 1700;
export const BALL_FRICTION = 1.6; // velocity decays as e^(-k·t)
export const REPICK_MS = 400; // the kicker cannot grab the ball back immediately
export const GOALS_TO_WIN = 2;
export const GOAL_PAUSE_MS = 1500;

// Shotgun: a fan of short-range pellets, strong up close.
export const SHOTGUN_PELLETS = 5;
export const SHOTGUN_SPREAD = 0.5;
export const SHOTGUN_RANGE = 420;
export const SHOTGUN_PELLET_DAMAGE = 0.45;

/** Human heroes are a bit tougher and hit harder than bots. */
export const HERO_BONUS = 1.2;

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
  team: number; // free-for-all: own id; football: 0 or 1
  weapon: Weapon;
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

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  holderId: number | null;
  lastTouchId: number | null;
  kickedAt: number;
}

export interface Bullet {
  id: number;
  ownerId: number;
  team: number;
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

export type Result = "win" | "loss" | "draw";

export interface Placement {
  playerId: number;
  userId: string | null;
  name: string;
  team: number;
  place: number;
  result: Result;
  kills: number;
  deaths: number;
  goals: number;
  damage: number;
}

export class Match {
  time = 0;
  readonly map: ArenaMap;
  readonly players = new Map<number, Player>();
  bullets: Bullet[] = [];
  kills: KillEvent[] = [];
  ball: Ball | null = null;
  score: [number, number] = [0, 0];
  lastGoal: { team: number; scorer: string; time: number } | null = null;
  private pausedUntil = 0;
  private nextId = 1;

  constructor(
    readonly mode: Mode,
    readonly durationMs: number,
    private readonly rng: Rng,
  ) {
    this.map = mode === "football" ? FOOTBALL_MAP : BRAWL_MAP;
    if (mode === "football") this.resetBall();
  }

  get timeLeftMs() {
    return Math.max(0, this.durationMs - this.time);
  }

  get isOver() {
    return this.time >= this.durationMs || Math.max(...this.score) >= GOALS_TO_WIN;
  }

  get isPaused() {
    return this.time < this.pausedUntil;
  }

  addPlayer(name: string, stats: Stats, userId: string | null, team?: number, weapon: Weapon = "rifle"): Player {
    const maxHp = Math.round(maxHpFor(stats) * (userId ? HERO_BONUS : 1));
    const id = this.nextId++;
    const p: Player = {
      id,
      name,
      userId,
      team: this.mode === "football" ? (team ?? 0) : id,
      weapon,
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
      goals: 0,
      damageDealt: 0,
      bot: userId === null ? { wander: null, strafe: 1, nextThinkAt: 0, lastX: 0, lastY: 0 } : undefined,
    };
    if (this.mode === "football") p.facing = p.team === 0 ? 0 : Math.PI;
    this.players.set(p.id, p);
    this.spawn(p);
    return p;
  }

  removePlayer(id: number) {
    if (this.ball?.holderId === id) this.dropBall();
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

  /** Fires one bullet, or kicks the ball when holding it. A zero aim vector auto-aims. */
  fire(id: number, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !p.alive || this.isPaused) return false;
    if (this.ball?.holderId === id) return this.kick(p, ax, ay, KICK_SPEED);
    if (p.ammo < 1 || this.time - p.lastShotAt < SHOT_COOLDOWN_MS) return false;
    const dir = this.aimDirection(p, ax, ay);
    if (!dir) return false;
    p.ammo -= 1;
    p.lastShotAt = this.time;
    p.facing = Math.atan2(dir.y, dir.x);
    if (p.weapon === "shotgun") {
      const pellet = Math.round(this.damageOf(p) * SHOTGUN_PELLET_DAMAGE);
      for (let i = 0; i < SHOTGUN_PELLETS; i++) {
        const angle = p.facing - SHOTGUN_SPREAD / 2 + (SHOTGUN_SPREAD * i) / (SHOTGUN_PELLETS - 1);
        this.spawnBullet(p, angle, SHOTGUN_RANGE, pellet, false);
      }
    } else {
      this.spawnBullet(p, p.facing, BULLET_RANGE, this.damageOf(p), false);
    }
    return true;
  }

  /** Releases a fully charged super: a cone of bullets, or a power kick when holding the ball. */
  useSuper(id: number, ax: number, ay: number): boolean {
    const p = this.players.get(id);
    if (!p || !p.alive || p.superCharge < 1 || this.isPaused) return false;
    if (this.ball?.holderId === id) {
      p.superCharge = 0;
      return this.kick(p, ax, ay, SUPER_KICK_SPEED);
    }
    const dir = this.aimDirection(p, ax, ay);
    if (!dir) return false;
    p.superCharge = 0;
    p.lastShotAt = this.time;
    p.facing = Math.atan2(dir.y, dir.x);
    for (let i = 0; i < SUPER_BULLETS; i++) {
      const angle = p.facing - SUPER_SPREAD / 2 + (SUPER_SPREAD * i) / (SUPER_BULLETS - 1);
      this.spawnBullet(p, angle, SUPER_RANGE, Math.round(this.damageOf(p) * 0.8), true);
    }
    return true;
  }

  step(dtMs: number) {
    this.time += dtMs;
    if (this.isPaused) return;
    const dt = dtMs / 1000;
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.spawn(p);
        continue;
      }
      if (p.bot) this.think(p);
      if (p.moveX || p.moveY) {
        const speed = speedFor(p.stats) * dt;
        const pos = this.map.resolveWalls(p.x + p.moveX * speed, p.y + p.moveY * speed, PLAYER_RADIUS);
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
    if (this.ball) this.moveBall(dt);
  }

  /** Whether `viewer` can currently see `target` (bushes hide enemies). */
  canSee(viewer: Player, target: Player): boolean {
    if (viewer.team === target.team || !this.map.isBush(target.x, target.y)) return true;
    if (this.time - target.lastShotAt < SHOT_REVEAL_MS || this.ball?.holderId === target.id) return true;
    return Math.hypot(viewer.x - target.x, viewer.y - target.y) < BUSH_REVEAL_DIST;
  }

  results(): Placement[] {
    const ranked = [...this.players.values()].sort(
      (a, b) => b.goals - a.goals || b.kills - a.kills || a.deaths - b.deaths || b.damageDealt - a.damageDealt,
    );
    if (this.mode === "football") {
      const [a, b] = this.score;
      const winner = a === b ? null : a > b ? 0 : 1;
      const resultOf = (p: Player): Result => (winner === null ? "draw" : p.team === winner ? "win" : "loss");
      ranked.sort((x, y) => +(resultOf(y) === "win") - +(resultOf(x) === "win"));
      return ranked.map((p) => this.placement(p, resultOf(p) === "loss" ? 2 : 1, resultOf(p)));
    }
    ranked.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damageDealt - a.damageDealt);
    return ranked.map((p, i) => this.placement(p, i + 1, i === 0 ? "win" : "loss"));
  }

  private placement(p: Player, place: number, result: Result): Placement {
    return {
      playerId: p.id,
      userId: p.userId,
      name: p.name,
      team: p.team,
      place,
      result,
      kills: p.kills,
      deaths: p.deaths,
      goals: p.goals,
      damage: Math.round(p.damageDealt),
    };
  }

  // ---- combat ----

  private damageOf(p: Player): number {
    return Math.round(damageFor(p.stats) * (p.userId ? HERO_BONUS : 1));
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
    this.bullets.push({ id: this.nextId++, ownerId: p.id, team: p.team, x: p.x, y: p.y, vx, vy, rangeLeft: range, damage, isSuper });
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
        if (b.rangeLeft <= 0 || this.map.isWall(b.x, b.y)) {
          alive = false;
          break;
        }
        for (const target of this.players.values()) {
          if (target.team === b.team || !target.alive) continue;
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
      const charge = owner.weapon === "shotgun" ? SUPER_PER_HIT / 3 : SUPER_PER_HIT;
      if (!b.isSuper) owner.superCharge = Math.min(1, owner.superCharge + charge);
    }
    if (target.hp <= 0) {
      if (this.ball?.holderId === target.id) this.dropBall();
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

  /** Puts a player at a spawn point at full health: own side in football, far from enemies otherwise. */
  private spawn(p: Player) {
    let choice: Vec;
    if (this.mode === "football") {
      const spawns = this.map.points(p.team === 0 ? "1" : "2");
      const mates = [...this.players.values()].filter((o) => o.team === p.team && o.id < p.id).length;
      choice = p.alive && p.deaths === 0 && this.time === 0 ? spawns[mates % spawns.length] : spawns[Math.floor(this.rng() * spawns.length)];
    } else {
      const enemies = [...this.players.values()].filter((o) => o.id !== p.id && o.alive);
      const scored = this.map
        .points("S")
        .map((s) => ({
          s,
          d: enemies.length ? Math.min(...enemies.map((e) => Math.hypot(e.x - s.x, e.y - s.y))) : this.rng(),
        }))
        .sort((a, b) => b.d - a.d);
      // Pick among the best few so respawns are not fully predictable.
      choice = scored[Math.floor(this.rng() * Math.min(3, scored.length))].s;
    }
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
      if (o.team === p.team || !o.alive || !this.canSee(p, o)) continue;
      const d = Math.hypot(o.x - p.x, o.y - p.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  // ---- football ----

  private resetBall() {
    this.ball = { x: this.map.width / 2, y: this.map.height / 2, vx: 0, vy: 0, holderId: null, lastTouchId: null, kickedAt: -Infinity };
  }

  private dropBall() {
    const ball = this.ball!;
    ball.holderId = null;
    ball.vx = 0;
    ball.vy = 0;
  }

  private kick(p: Player, ax: number, ay: number, speed: number): boolean {
    const ball = this.ball!;
    const len = Math.hypot(ax, ay);
    // A tap kicks straight at the opponents' goal.
    const goal = this.goalCenter(1 - p.team);
    const dir = len > 0.01 ? { x: ax / len, y: ay / len } : this.unit(goal.x - p.x, goal.y - p.y);
    ball.holderId = null;
    ball.vx = dir.x * speed;
    ball.vy = dir.y * speed;
    ball.kickedAt = this.time;
    ball.lastTouchId = p.id;
    p.facing = Math.atan2(dir.y, dir.x);
    return true;
  }

  goalCenter(team: number): Vec {
    const pts = this.map.points(team === 0 ? "A" : "B");
    return { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  }

  private unit(x: number, y: number): Vec {
    const d = Math.hypot(x, y) || 1;
    return { x: x / d, y: y / d };
  }

  private moveBall(dt: number) {
    const ball = this.ball!;
    const holder = ball.holderId !== null ? this.players.get(ball.holderId) : undefined;
    if (holder) {
      ball.x = holder.x + Math.cos(holder.facing) * (PLAYER_RADIUS + BALL_RADIUS - 6);
      ball.y = holder.y + Math.sin(holder.facing) * (PLAYER_RADIUS + BALL_RADIUS - 6);
      // Do not carry the ball into a wall.
      const fixed = this.map.resolveWalls(ball.x, ball.y, BALL_RADIUS);
      ball.x = fixed.x;
      ball.y = fixed.y;
    } else {
      const steps = Math.max(1, Math.ceil((Math.hypot(ball.vx, ball.vy) * dt) / 12));
      for (let i = 0; i < steps; i++) {
        const nx = ball.x + (ball.vx * dt) / steps;
        const ny = ball.y + (ball.vy * dt) / steps;
        // Bounce off walls axis by axis.
        if (this.touchesWall(nx, ball.y)) ball.vx = -ball.vx * 0.6;
        else ball.x = nx;
        if (this.touchesWall(ball.x, ny)) ball.vy = -ball.vy * 0.6;
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
        if (!p.alive) continue;
        if (p.id === ball.lastTouchId && this.time - ball.kickedAt < REPICK_MS) continue;
        if (Math.hypot(p.x - ball.x, p.y - ball.y) <= PLAYER_RADIUS + BALL_RADIUS) {
          ball.holderId = p.id;
          ball.lastTouchId = p.id;
          ball.vx = 0;
          ball.vy = 0;
          break;
        }
      }
    }
    const tile = this.map.tileAt(ball.x, ball.y);
    if (tile === "A" || tile === "B") this.goal(tile === "A" ? 1 : 0);
  }

  private touchesWall(x: number, y: number): boolean {
    return [
      [x - BALL_RADIUS, y],
      [x + BALL_RADIUS, y],
      [x, y - BALL_RADIUS],
      [x, y + BALL_RADIUS],
    ].some(([px, py]) => this.map.isWall(px, py));
  }

  private goal(team: number) {
    this.score[team] += 1;
    const scorer = this.ball!.lastTouchId !== null ? this.players.get(this.ball!.lastTouchId) : undefined;
    if (scorer && scorer.team === team) scorer.goals += 1;
    this.lastGoal = { team, scorer: scorer?.name ?? "", time: this.time };
    this.resetBall();
    this.bullets = [];
    this.pausedUntil = this.time + GOAL_PAUSE_MS;
    // Kick-off: everyone back to their own half.
    const counts = [0, 0];
    for (const p of this.players.values()) {
      const spawns = this.map.points(p.team === 0 ? "1" : "2");
      const s = spawns[counts[p.team]++ % spawns.length];
      Object.assign(p, { x: s.x, y: s.y, hp: p.maxHp, alive: true, ammo: AMMO_MAX, moveX: 0, moveY: 0 });
    }
  }

  // ---- bots ----

  private think(p: Player) {
    const brain = p.bot!;
    if (this.time < brain.nextThinkAt) return;
    brain.nextThinkAt = this.time + 100 + this.rng() * 100;
    if (this.mode === "football" && this.thinkFootball(p)) {
      brain.lastX = p.x;
      brain.lastY = p.y;
      return;
    }
    const target = this.nearestEnemy(p, 900);
    if (target) this.fight(p, target, true);
    else this.wander(p);
    brain.lastX = p.x;
    brain.lastY = p.y;
  }

  /** Football decisions; returns false to fall back to plain fighting. */
  private thinkFootball(p: Player): boolean {
    const ball = this.ball!;
    if (ball.holderId === p.id) {
      const goal = this.goalCenter(1 - p.team);
      const d = Math.hypot(goal.x - p.x, goal.y - p.y);
      if (d < 400 && this.map.lineOfSight(p.x, p.y, goal.x, goal.y)) {
        const err = (this.rng() - 0.5) * 0.2;
        const a = Math.atan2(goal.y - p.y, goal.x - p.x) + err;
        if (p.superCharge >= 1) this.useSuper(p.id, Math.cos(a), Math.sin(a));
        else this.fire(p.id, Math.cos(a), Math.sin(a));
      } else {
        // Walk toward the goal, sliding around walls.
        const dir = this.unit(goal.x - p.x, goal.y - p.y);
        const stuck = Math.hypot(p.x - p.bot!.lastX, p.y - p.bot!.lastY) < 2;
        this.setMove(p.id, dir.x + (stuck ? -dir.y : 0), dir.y + (stuck ? dir.x : 0));
      }
      return true;
    }
    const holder = ball.holderId !== null ? this.players.get(ball.holderId) : undefined;
    if (holder && holder.team !== p.team) {
      this.fight(p, holder, false); // chase and shoot the carrier
      return true;
    }
    // One bot per team stays back as a goalkeeper unless its own team has the ball.
    const keeper = [...this.players.values()].filter((o) => o.team === p.team && o.bot && o.alive).pop();
    if (keeper?.id === p.id && holder?.team !== p.team) {
      const own = this.goalCenter(p.team);
      const dir = this.unit(ball.x - own.x, ball.y - own.y);
      const spot = { x: own.x + dir.x * 180, y: own.y + dir.y * 180 };
      const dist = Math.hypot(spot.x - p.x, spot.y - p.y);
      this.setMove(p.id, dist > 20 ? spot.x - p.x : 0, dist > 20 ? spot.y - p.y : 0);
      const threat = this.nearestEnemy(p, BULLET_RANGE);
      if (threat && this.map.lineOfSight(p.x, p.y, threat.x, threat.y) && this.rng() < 0.6) {
        this.fire(p.id, threat.x - p.x, threat.y - p.y);
      }
      return true;
    }
    if (!holder) {
      const mates = [...this.players.values()].filter((o) => o.team === p.team && o.alive && o.id !== keeper?.id);
      const chaser = mates.sort((a, b) => Math.hypot(a.x - ball.x, a.y - ball.y) - Math.hypot(b.x - ball.x, b.y - ball.y))[0];
      if (chaser?.id === p.id) {
        this.setMove(p.id, ball.x - p.x, ball.y - p.y);
        return true;
      }
    }
    return false;
  }

  /** Keeps a mid-range distance, circles the target and shoots. `keepDistance` false = close in. */
  private fight(p: Player, target: Player, keepDistance: boolean) {
    const brain = p.bot!;
    const dx = target.x - p.x;
    const dy = target.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    if (this.rng() < 0.05) brain.strafe = -brain.strafe;
    const toward = !keepDistance ? (d > 150 ? 1 : 0) : d > 440 ? 1 : d < 300 ? -1 : 0;
    this.setMove(p.id, ux * toward - uy * brain.strafe * 0.8, uy * toward + ux * brain.strafe * 0.8);
    if (this.ball?.holderId === p.id) return;
    const sees = this.map.lineOfSight(p.x, p.y, target.x, target.y);
    if (sees && p.superCharge >= 1 && d < SUPER_RANGE - 40) {
      this.useSuper(p.id, dx, dy);
    } else if (sees && d < BULLET_RANGE && this.rng() < 0.6) {
      const err = (this.rng() - 0.5) * 0.25;
      const a = Math.atan2(dy, dx) + err;
      this.fire(p.id, Math.cos(a), Math.sin(a));
    }
  }

  private wander(p: Player) {
    const brain = p.bot!;
    const stuck = Math.hypot(p.x - brain.lastX, p.y - brain.lastY) < 2;
    if (!brain.wander || stuck || Math.hypot(brain.wander.x - p.x, brain.wander.y - p.y) < 40) {
      brain.wander = { x: 100 + this.rng() * (this.map.width - 200), y: 100 + this.rng() * (this.map.height - 200) };
    }
    this.setMove(p.id, brain.wander.x - p.x, brain.wander.y - p.y);
  }
}
