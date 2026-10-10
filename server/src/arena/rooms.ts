// Matchmaking and the per-match game loop. Sockets are abstracted as `Client` so tests can fake them.
import { BASE_STATS, type Stats } from "../game/progression.js";
import { TILE } from "./map.js";
import { BALL_RADIUS, Match, MODES, PLAYER_RADIUS, WEAPONS, type Mode, type Placement, type Player, type Rng, type Weapon } from "./sim.js";

export interface Client {
  userId: string;
  name: string;
  stats: Stats;
  weapon: Weapon;
  send(msg: unknown): void;
}

export interface ArenaOptions {
  rng: Rng;
  queueWaitMs: number;
  tickMs: number;
  /** Overrides every mode's match length (tests). */
  durationMs?: number;
  /** Called once per finished match with every human's placement. Returns XP per user id. */
  onFinish(mode: Mode, results: Placement[], playerCount: number): Promise<Map<string, number>>;
}

export const DEFAULT_ARENA = { queueWaitMs: 3000, tickMs: 33 };

export const MODE_RULES: Record<Mode, { players: number; durationMs: number }> = {
  brawl: { players: 6, durationMs: 120_000 },
  football: { players: 6, durationMs: 150_000 },
};

const BOT_NAMES = ["Громила", "Тень", "Бешеный Пёс", "Кузнец", "Вихрь", "Молчун", "Медведь", "Лис", "Кобра", "Шип"];

interface Room {
  match: Match;
  members: Map<Client, number>; // client -> player id
  timer: NodeJS.Timeout;
}

interface Queue {
  clients: Client[];
  timer: NodeJS.Timeout | null;
}

export class Arena {
  private queues = new Map<Mode, Queue>(MODES.map((m) => [m, { clients: [], timer: null }]));
  private roomOf = new Map<Client, Room>();
  private rooms = new Set<Room>();

  constructor(private readonly opts: ArenaOptions) {}

  join(client: Client, mode: Mode) {
    if (this.roomOf.has(client) || this.queueOf(client)) return;
    const q = this.queues.get(mode)!;
    q.clients.push(client);
    client.send({ t: "queued", mode, players: q.clients.length });
    if (q.clients.length >= MODE_RULES[mode].players) this.startMatch(mode);
    else if (!q.timer) q.timer = setTimeout(() => this.startMatch(mode), this.opts.queueWaitMs);
  }

  leave(client: Client) {
    for (const q of this.queues.values()) q.clients = q.clients.filter((c) => c !== client);
    const room = this.roomOf.get(client);
    if (room) {
      const id = room.members.get(client);
      if (id !== undefined) room.match.removePlayer(id);
      room.members.delete(client);
      this.roomOf.delete(client);
      if (room.members.size === 0) {
        clearInterval(room.timer);
        this.rooms.delete(room);
      }
    }
  }

  input(client: Client, msg: { t: string; mx?: number; my?: number; ax?: number; ay?: number }) {
    const room = this.roomOf.get(client);
    const id = room?.members.get(client);
    if (!room || id === undefined) return;
    if (msg.t === "move") room.match.setMove(id, Number(msg.mx), Number(msg.my));
    else if (msg.t === "fire") room.match.fire(id, Number(msg.ax ?? 0), Number(msg.ay ?? 0));
    else if (msg.t === "super") room.match.useSuper(id, Number(msg.ax ?? 0), Number(msg.ay ?? 0));
  }

  shutdown() {
    for (const q of this.queues.values()) if (q.timer) clearTimeout(q.timer);
    for (const room of this.rooms) clearInterval(room.timer);
    this.rooms.clear();
  }

  private queueOf(client: Client) {
    return [...this.queues.values()].find((q) => q.clients.includes(client));
  }

  private startMatch(mode: Mode) {
    const q = this.queues.get(mode)!;
    if (q.timer) clearTimeout(q.timer);
    q.timer = null;
    const size = MODE_RULES[mode].players;
    const humans = q.clients.splice(0, size);
    if (humans.length === 0) return;
    if (q.clients.length > 0) q.timer = setTimeout(() => this.startMatch(mode), this.opts.queueWaitMs);

    const match = new Match(mode, this.opts.durationMs ?? MODE_RULES[mode].durationMs, this.opts.rng);
    const members = new Map<Client, number>();
    // Football: humans alternate between teams so friends can end up on either side.
    humans.forEach((c, i) => members.set(c, match.addPlayer(c.name, c.stats, c.userId, i % 2, c.weapon).id));
    const names = BOT_NAMES.filter((n) => !humans.some((h) => h.name === n));
    const teamSizes = [0, 0];
    for (const p of match.players.values()) teamSizes[p.team === 1 ? 1 : 0]++;
    for (let i = humans.length; i < size; i++) {
      const stats = { ...BASE_STATS };
      const keys = Object.keys(stats) as (keyof Stats)[];
      // Bots get a few random points so they are not all identical.
      for (let k = 0; k < 2; k++) stats[keys[Math.floor(this.opts.rng() * keys.length)]] += 1;
      const name = names.splice(Math.floor(this.opts.rng() * names.length), 1)[0] ?? `Бот ${i}`;
      const team = teamSizes[0] <= teamSizes[1] ? 0 : 1;
      teamSizes[team]++;
      match.addPlayer(name, stats, null, team, WEAPONS[Math.floor(this.opts.rng() * WEAPONS.length)]);
    }

    const room: Room = { match, members, timer: setInterval(() => this.tick(room), this.opts.tickMs) };
    this.rooms.add(room);
    const map = { cols: match.map.cols, rows: match.map.rows, tile: TILE, layout: match.map.layout, playerRadius: PLAYER_RADIUS };
    for (const [c, id] of members) {
      this.roomOf.set(c, room);
      c.send({ t: "start", mode, you: id, team: match.players.get(id)!.team, map, durationMs: match.durationMs });
    }
  }

  private tick(room: Room) {
    room.match.step(this.opts.tickMs);
    for (const [c, id] of room.members) c.send(snapshot(room.match, id));
    if (room.match.isOver) void this.finish(room);
  }

  private async finish(room: Room) {
    clearInterval(room.timer);
    this.rooms.delete(room);
    const { match } = room;
    const results = match.results();
    const humans = results.filter((r) => r.userId !== null);
    let xp = new Map<string, number>();
    try {
      xp = await this.opts.onFinish(match.mode, humans, results.length);
    } catch {
      // Results are still shown even if saving failed.
    }
    for (const [c, id] of room.members) {
      const mine = results.find((r) => r.playerId === id);
      c.send({
        t: "end",
        mode: match.mode,
        place: mine?.place,
        result: mine?.result,
        team: mine?.team,
        score: match.mode === "football" ? match.score : undefined,
        xpGained: xp.get(c.userId) ?? 0,
        results: results.map((r) => ({
          name: r.name,
          place: r.place,
          team: r.team,
          kills: r.kills,
          deaths: r.deaths,
          goals: r.goals,
          you: r.playerId === id,
        })),
      });
      this.roomOf.delete(c);
    }
  }
}

const r = Math.round;

/** What one player is allowed to see this tick: hidden enemies in bushes are left out. */
export function snapshot(match: Match, viewerId: number) {
  const viewer = match.players.get(viewerId);
  const players = [...match.players.values()]
    .filter((p) => !viewer || match.canSee(viewer, p))
    .map((p: Player) => ({
      id: p.id,
      name: p.name,
      x: r(p.x),
      y: r(p.y),
      f: Math.round(p.facing * 100) / 100,
      hp: r(p.hp),
      maxHp: p.maxHp,
      alive: p.alive,
      c: p.color,
      tm: p.team,
      w: p.weapon,
      k: p.kills,
    }));
  const ball = match.ball;
  return {
    t: "state",
    time: match.time,
    left: match.timeLeftMs,
    me: viewer && {
      ammo: Math.round(viewer.ammo * 100) / 100,
      sup: Math.round(viewer.superCharge * 100) / 100,
      respawnIn: viewer.alive ? 0 : Math.max(0, viewer.respawnAt - match.time),
    },
    players,
    bullets: match.bullets.map((b) => ({ id: b.id, x: r(b.x), y: r(b.y), o: b.ownerId, tm: b.team, s: b.isSuper })),
    feed: match.kills.slice(-4),
    ball: ball && { x: r(ball.x), y: r(ball.y), h: ball.holderId, r: BALL_RADIUS },
    score: match.mode === "football" ? match.score : undefined,
    goal: match.lastGoal && match.time - match.lastGoal.time < 2500 ? match.lastGoal : undefined,
  };
}
