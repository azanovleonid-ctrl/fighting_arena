// Matchmaking and the per-match game loop. Sockets are abstracted as `Client` so tests can fake them.
import { BRAWLER_IDS, type BrawlerId } from "./brawlers.js";
import { TILE } from "./map.js";
import {
  BALL_RADIUS,
  BEACON_RADIUS,
  isSurvival,
  Match,
  MODES,
  PLAYER_RADIUS,
  type Mode,
  type Placement,
  type Player,
  type Rng,
} from "./sim.js";

export interface Client {
  userId: string;
  name: string;
  brawler: BrawlerId;
  level: number;
  send(msg: unknown): void;
}

export interface ArenaOptions {
  rng: Rng;
  queueWaitMs: number;
  tickMs: number;
  /** Overrides every mode's match length (tests). */
  durationMs?: number;
  /** Called with the humans whose results became final. Returns XP per user id. */
  onFinish(mode: Mode, results: Placement[], playerCount: number): Promise<Map<string, number>>;
}

export const DEFAULT_ARENA = { queueWaitMs: 3000, tickMs: 33 };

/** Survival modes end when one team is left; their length is only a safety cap. */
export const MODE_RULES: Record<Mode, { players: number; teams: number; durationMs: number }> = {
  survival: { players: 6, teams: 6, durationMs: 240_000 },
  duo: { players: 6, teams: 3, durationMs: 240_000 },
  ball: { players: 6, teams: 2, durationMs: 150_000 },
  beacon: { players: 6, teams: 2, durationMs: 150_000 },
};

const BOT_NAMES = ["Громила", "Тень", "Бешеный Пёс", "Кузнец", "Вихрь", "Молчун", "Медведь", "Лис", "Кобра", "Шип"];

interface Room {
  match: Match;
  members: Map<Client, number>; // client -> player id, until their result is final
  timer: NodeJS.Timeout | null;
}

/** A private room for playing with a friend: the host gets a code, the friend joins with it. */
interface Party {
  code: string;
  mode: Mode;
  /** Same team, or against each other (survival is always against). */
  together: boolean;
  host: Client;
  timer: NodeJS.Timeout;
}

const PARTY_TTL_MS = 15 * 60_000;

interface Queue {
  clients: Client[];
  timer: NodeJS.Timeout | null;
}

export class Arena {
  private queues = new Map<Mode, Queue>(MODES.map((m) => [m, { clients: [], timer: null }]));
  private roomOf = new Map<Client, Room>();
  private rooms = new Set<Room>();
  private parties = new Map<string, Party>();

  constructor(private readonly opts: ArenaOptions) {}

  join(client: Client, mode: Mode) {
    if (this.roomOf.has(client) || this.queueOf(client) || this.partyOf(client)) return;
    const q = this.queues.get(mode)!;
    q.clients.push(client);
    client.send({ t: "queued", mode, players: q.clients.length });
    if (q.clients.length >= MODE_RULES[mode].players) this.startMatch(mode);
    else if (!q.timer) q.timer = setTimeout(() => this.startMatch(mode), this.opts.queueWaitMs);
  }

  /** Opens a private room and sends its code; the match starts when a friend joins with it. */
  createParty(client: Client, mode: Mode, together: boolean) {
    if (this.roomOf.has(client) || this.queueOf(client) || this.partyOf(client)) return;
    let code: string;
    do code = String(1000 + Math.floor(Math.random() * 9000));
    while (this.parties.has(code));
    const party: Party = {
      code,
      mode,
      together: together && mode !== "survival",
      host: client,
      timer: setTimeout(() => this.closeParty(code, "Друг не подключился, комната закрыта"), PARTY_TTL_MS),
    };
    this.parties.set(code, party);
    client.send({ t: "party", code, mode, together: party.together });
  }

  /** Joins a friend's room by its code and starts the match for both. */
  joinParty(client: Client, code: string) {
    if (this.roomOf.has(client) || this.queueOf(client) || this.partyOf(client)) return;
    const party = this.parties.get(code);
    if (!party) {
      client.send({ t: "party_error", message: "Комната с таким кодом не найдена" });
      return;
    }
    clearTimeout(party.timer);
    this.parties.delete(code);
    const { teams } = MODE_RULES[party.mode];
    this.launch(party.mode, [
      { client: party.host, team: 0 },
      { client, team: party.together ? 0 : Math.min(1, teams - 1) },
    ]);
  }

  leave(client: Client) {
    const party = this.partyOf(client);
    if (party) this.closeParty(party.code, null);
    for (const q of this.queues.values()) q.clients = q.clients.filter((c) => c !== client);
    const room = this.roomOf.get(client);
    if (!room) return;
    const id = room.members.get(client);
    if (id !== undefined) room.match.dropToBot(id);
    room.members.delete(client);
    this.roomOf.delete(client);
    if (room.members.size === 0) this.close(room);
  }

  input(client: Client, msg: { t: string; mx?: number; my?: number; ax?: number; ay?: number; s?: number }) {
    const room = this.roomOf.get(client);
    const id = room?.members.get(client);
    if (!room || id === undefined) return;
    if (msg.t === "move") {
      if (msg.s !== undefined) room.match.queueMove(id, Number(msg.mx), Number(msg.my), Number(msg.s));
      else room.match.setMove(id, Number(msg.mx), Number(msg.my));
    }
    else if (msg.t === "fire") room.match.fire(id, Number(msg.ax ?? 0), Number(msg.ay ?? 0));
    else if (msg.t === "super") room.match.useSuper(id, Number(msg.ax ?? 0), Number(msg.ay ?? 0));
  }

  shutdown() {
    for (const q of this.queues.values()) if (q.timer) clearTimeout(q.timer);
    for (const room of this.rooms) if (room.timer) clearTimeout(room.timer);
    for (const party of this.parties.values()) clearTimeout(party.timer);
    this.parties.clear();
    this.rooms.clear();
  }

  private partyOf(client: Client) {
    return [...this.parties.values()].find((p) => p.host === client);
  }

  private closeParty(code: string, message: string | null) {
    const party = this.parties.get(code);
    if (!party) return;
    clearTimeout(party.timer);
    this.parties.delete(code);
    if (message) party.host.send({ t: "party_error", message });
  }

  private queueOf(client: Client) {
    return [...this.queues.values()].find((q) => q.clients.includes(client));
  }

  private startMatch(mode: Mode) {
    const q = this.queues.get(mode)!;
    if (q.timer) clearTimeout(q.timer);
    q.timer = null;
    const { players: size, teams } = MODE_RULES[mode];
    const humans = q.clients.splice(0, size);
    if (humans.length === 0) return;
    if (q.clients.length > 0) q.timer = setTimeout(() => this.startMatch(mode), this.opts.queueWaitMs);

    // Humans are spread over the teams first; bots fill the free places.
    this.launch(mode, humans.map((client, i) => ({ client, team: i % teams })));
  }

  /** Starts a match with these humans on the given teams; bots take the free places. */
  private launch(mode: Mode, humans: { client: Client; team: number }[]) {
    const { players: size, teams } = MODE_RULES[mode];
    const match = new Match(mode, this.opts.durationMs ?? MODE_RULES[mode].durationMs, this.opts.rng);
    const members = new Map<Client, number>();
    const perTeam = size / teams;
    const teamSizes = Array.from({ length: teams }, () => 0);
    for (const { client: c, team } of humans) {
      teamSizes[team]++;
      members.set(c, match.addPlayer(c.name, c.brawler, c.level, c.userId, team).id);
    }
    const names = BOT_NAMES.filter((n) => !humans.some((h) => h.client.name === n));
    for (let i = humans.length; i < size; i++) {
      const team = teamSizes.findIndex((n) => n < perTeam);
      teamSizes[team]++;
      const name = names.splice(Math.floor(this.opts.rng() * names.length), 1)[0] ?? `Бот ${i}`;
      const brawler = BRAWLER_IDS[Math.floor(this.opts.rng() * BRAWLER_IDS.length) % BRAWLER_IDS.length];
      match.addPlayer(name, brawler, 1, null, team);
    }

    const room: Room = { match, members, timer: null };
    this.rooms.add(room);
    this.schedule(room, performance.now() + this.opts.tickMs);
    const map = { cols: match.map.cols, rows: match.map.rows, tile: TILE, layout: match.map.layout, playerRadius: PLAYER_RADIUS };
    for (const [c, id] of members) {
      this.roomOf.set(c, room);
      const p = match.players.get(id)!;
      c.send({ t: "start", mode, you: id, team: p.team, brawler: p.brawler.id, map, durationMs: match.durationMs, beaconRadius: BEACON_RADIUS });
    }
  }

  /**
   * Runs ticks on a fixed beat: each one is aimed at its own due time, so late timers don't add up
   * and the match clock keeps pace with real time (phones send one move per tick).
   */
  private schedule(room: Room, due: number) {
    room.timer = setTimeout(() => {
      if (!this.rooms.has(room)) return;
      this.tick(room);
      const now = performance.now();
      const next = due + this.opts.tickMs < now - 100 ? now : due + this.opts.tickMs;
      if (this.rooms.has(room)) this.schedule(room, next);
    }, Math.max(0, due - performance.now()));
  }

  private tick(room: Room) {
    const { match } = room;
    match.step(this.opts.tickMs);
    const done: [Client, Placement][] = [];
    for (const [c, id] of room.members) {
      c.send(snapshot(match, id));
      const placement = match.placementOf(id);
      if (placement) done.push([c, placement]);
    }
    if (done.length) void this.finish(room, done);
    if (match.isOver || room.members.size === 0) this.close(room);
  }

  private close(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    this.rooms.delete(room);
  }

  /** Sends final results to players whose match is over (everyone at the end, or knocked out in survival). */
  private async finish(room: Room, done: [Client, Placement][]) {
    const { match } = room;
    for (const [c] of done) {
      room.members.delete(c);
      this.roomOf.delete(c);
    }
    const humans = done.map(([, p]) => p).filter((p) => p.userId !== null);
    let xp = new Map<string, number>();
    try {
      xp = await this.opts.onFinish(match.mode, humans, match.players.size);
    } catch {
      // Results are still shown even if saving failed.
    }
    // Survival players knocked out early see the standings so far: place 0 = still fighting.
    const list = match.isOver
      ? match.results()
      : [...match.players.values()].map((p) => match.placementOf(p.id) ?? fallback(p)).sort((a, b) => a.place - b.place);
    for (const [c, mine] of done) {
      c.send({
        t: "end",
        mode: match.mode,
        brawler: match.players.get(mine.playerId)?.brawler.id,
        place: mine.place,
        result: mine.result,
        team: mine.team,
        score: match.mode === "ball" ? match.score : undefined,
        beacon: match.mode === "beacon" ? match.beacon.map((v) => Math.round(v * 100)) : undefined,
        xpGained: xp.get(c.userId) ?? 0,
        results: list.map((r) => row(r, r.playerId === mine.playerId)),
      });
    }
  }
}

function row(r: Placement, you: boolean) {
  return { name: r.name, brawler: r.brawler, place: r.place, team: r.team, kills: r.kills, deaths: r.deaths, goals: r.goals, cubes: r.cubes, you };
}

function fallback(p: Player): Placement {
  return {
    playerId: p.id,
    userId: p.userId,
    name: p.name,
    brawler: p.brawler.id,
    team: p.team,
    place: 0,
    result: "loss",
    kills: p.kills,
    deaths: p.deaths,
    goals: p.goals,
    cubes: p.cubesPicked,
    damage: Math.round(p.damageDealt),
  };
}

const r = Math.round;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** What one player is allowed to see this tick: hidden enemies (bushes, invisibility) are left out. */
export function snapshot(match: Match, viewerId: number) {
  const viewer = match.players.get(viewerId);
  const t = match.time;
  // A knocked-out duo player watches through the partner's eyes.
  const eyes = viewer && !viewer.alive && match.mode === "duo"
    ? [...match.players.values()].find((p) => p.team === viewer.team && p.alive) ?? viewer
    : viewer;
  const players = [...match.players.values()]
    .filter((p) => !p.out || p.id === viewerId)
    .filter((p) => !eyes || match.canSee(eyes, p))
    .map((p: Player) => ({
      id: p.id,
      name: p.name,
      b: p.brawler.id,
      x: r(p.x),
      y: r(p.y),
      f: r2(p.facing),
      hp: r(p.hp),
      maxHp: p.maxHp,
      alive: p.alive,
      c: p.color,
      tm: p.team,
      k: p.kills,
      cu: p.cubes,
      sh: t < p.shieldUntil,
      sl: t < p.slowUntil,
      inv: t < p.invisUntil,
      air: p.jump ? r2((t - p.jump.start) / (p.jump.end - p.jump.start)) : undefined,
    }));
  const ball = match.ball;
  return {
    t: "state",
    time: t,
    left: match.timeLeftMs,
    me: viewer && {
      ammo: r2(viewer.ammo),
      ack: viewer.ack,
      sup: r2(viewer.superCharge),
      respawnIn: viewer.alive || viewer.out ? 0 : Math.max(0, viewer.respawnAt - t),
      out: viewer.out,
      follow: eyes?.id,
    },
    players,
    shots: match.shots
      .filter((s) => t >= s.t0)
      .map((s) => ({
        id: s.id,
        k: s.kind,
        x: r(s.x),
        y: r(s.y),
        o: s.ownerId,
        tm: s.team,
        s: s.isSuper,
        ...(s.kind === "bomb" ? { tx: r(s.tx), ty: r(s.ty), z: r2((t - s.t0) / (s.t1 - s.t0)), br: s.blast } : {}),
      })),
    turrets: match.turrets.map((u) => ({ id: u.id, x: r(u.x), y: r(u.y), hp: r(u.hp), maxHp: r(u.maxHp), tm: u.team, o: u.ownerId })),
    zones: match.zones.map((z) => ({ id: z.id, x: r(z.x), y: r(z.y), r: z.r, tm: z.team })),
    cubes: match.cubes.map((c) => ({ id: c.id, x: r(c.x), y: r(c.y) })),
    boxes: isSurvival(match.mode) ? [...match.map.boxes].map(([i, hp]) => [i, r(hp)]) : undefined,
    fx: match.effects.map((e) => ({ id: e.id, k: e.k, x: r(e.x), y: r(e.y), r: e.r, a: r2(e.a), age: t - e.time })),
    gas: match.gasRadius !== null ? r(match.gasRadius) : undefined,
    teamsLeft: isSurvival(match.mode) ? match.teamsLeft : undefined,
    feed: match.kills.slice(-4),
    ball: ball && { x: r(ball.x), y: r(ball.y), h: ball.holderId, r: BALL_RADIUS },
    score: match.mode === "ball" ? match.score : undefined,
    beacon: match.mode === "beacon" ? { p: match.beacon.map((v) => r2(v)), s: match.beaconState } : undefined,
    pause: match.isPaused ? match.pausedUntil - t : 0,
    goal: match.lastGoal && t - match.lastGoal.time < 2500 ? match.lastGoal : undefined,
  };
}
