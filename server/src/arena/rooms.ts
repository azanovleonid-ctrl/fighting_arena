// Matchmaking and the per-match game loop. Sockets are abstracted as `Client` so tests can fake them.
import { BASE_STATS, type Stats } from "../game/progression.js";
import { COLS, LAYOUT, ROWS, TILE } from "./map.js";
import { Match, PLAYER_RADIUS, type Placement, type Player, type Rng } from "./sim.js";

export interface Client {
  userId: string;
  name: string;
  stats: Stats;
  send(msg: unknown): void;
}

export interface ArenaOptions {
  rng: Rng;
  maxPlayers: number;
  queueWaitMs: number;
  durationMs: number;
  tickMs: number;
  /** Called once per finished match with every human's placement. Returns XP per user id. */
  onFinish(results: Placement[], playerCount: number): Promise<Map<string, number>>;
}

export const DEFAULT_ARENA = { maxPlayers: 6, queueWaitMs: 3000, durationMs: 120_000, tickMs: 33 };

const BOT_NAMES = ["Громила", "Тень", "Бешеный Пёс", "Кузнец", "Вихрь", "Молчун", "Медведь", "Лис", "Кобра", "Шип"];

interface Room {
  match: Match;
  members: Map<Client, number>; // client -> player id
  timer: NodeJS.Timeout;
}

export class Arena {
  private queue: Client[] = [];
  private queueTimer: NodeJS.Timeout | null = null;
  private roomOf = new Map<Client, Room>();
  private rooms = new Set<Room>();

  constructor(private readonly opts: ArenaOptions) {}

  join(client: Client) {
    if (this.roomOf.has(client) || this.queue.includes(client)) return;
    this.queue.push(client);
    client.send({ t: "queued", players: this.queue.length });
    if (this.queue.length >= this.opts.maxPlayers) this.startMatch();
    else if (!this.queueTimer) this.queueTimer = setTimeout(() => this.startMatch(), this.opts.queueWaitMs);
  }

  leave(client: Client) {
    this.queue = this.queue.filter((c) => c !== client);
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
    if (this.queueTimer) clearTimeout(this.queueTimer);
    for (const room of this.rooms) clearInterval(room.timer);
    this.rooms.clear();
  }

  private startMatch() {
    if (this.queueTimer) clearTimeout(this.queueTimer);
    this.queueTimer = null;
    const humans = this.queue.splice(0, this.opts.maxPlayers);
    if (humans.length === 0) return;
    if (this.queue.length > 0) this.queueTimer = setTimeout(() => this.startMatch(), this.opts.queueWaitMs);

    const match = new Match(this.opts.durationMs, this.opts.rng);
    const members = new Map<Client, number>();
    for (const c of humans) members.set(c, match.addPlayer(c.name, c.stats, c.userId).id);
    const names = BOT_NAMES.filter((n) => !humans.some((h) => h.name === n));
    for (let i = humans.length; i < this.opts.maxPlayers; i++) {
      const stats = { ...BASE_STATS };
      const keys = Object.keys(stats) as (keyof Stats)[];
      // Bots get a few random points so they are not all identical.
      for (let k = 0; k < 2; k++) stats[keys[Math.floor(this.opts.rng() * keys.length)]] += 1;
      const name = names.splice(Math.floor(this.opts.rng() * names.length), 1)[0] ?? `Бот ${i}`;
      match.addPlayer(name, stats, null);
    }

    const room: Room = { match, members, timer: setInterval(() => this.tick(room), this.opts.tickMs) };
    this.rooms.add(room);
    const map = { cols: COLS, rows: ROWS, tile: TILE, layout: LAYOUT, playerRadius: PLAYER_RADIUS };
    for (const [c, id] of members) {
      this.roomOf.set(c, room);
      c.send({ t: "start", you: id, map, durationMs: match.durationMs });
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
    const results = room.match.results();
    const humans = results.filter((r) => r.userId !== null);
    let xp = new Map<string, number>();
    try {
      xp = await this.opts.onFinish(humans, results.length);
    } catch {
      // Results are still shown even if saving failed.
    }
    for (const [c, id] of room.members) {
      const mine = results.find((r) => r.playerId === id);
      c.send({
        t: "end",
        place: mine?.place,
        xpGained: xp.get(c.userId) ?? 0,
        results: results.map((r) => ({ name: r.name, place: r.place, kills: r.kills, deaths: r.deaths, you: r.playerId === id })),
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
      k: p.kills,
    }));
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
    bullets: match.bullets.map((b) => ({ id: b.id, x: r(b.x), y: r(b.y), o: b.ownerId, s: b.isSuper })),
    feed: match.kills.slice(-4),
  };
}
