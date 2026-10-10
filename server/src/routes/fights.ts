import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../app.js";
import { makeBot } from "../game/bot.js";
import {
  applyXp,
  BLOCKS_PER_TURN,
  makeFighter,
  newFight,
  playRound,
  randomMove,
  xpFor,
  ZONES,
  type FightState,
} from "../game/engine.js";
import { findUserById } from "../users.js";

interface FightRow {
  id: string;
  user_id: string;
  opponent: string;
  status: "active" | "finished";
  result: "win" | "loss" | "draw" | null;
  state: FightState;
  xp_gained: number;
  created_at: Date;
  finished_at: Date | null;
}

const zone = z.enum(ZONES);
const moveSchema = z
  .object({ attack: zone, blocks: z.array(zone).length(BLOCKS_PER_TURN) })
  .refine((m) => new Set(m.blocks).size === m.blocks.length, "Зоны блока должны различаться");

function toView(f: FightRow) {
  const { player, opponent, rounds } = f.state;
  return {
    id: f.id,
    status: f.status,
    result: f.result,
    player: { name: player.name, hp: player.hp, maxHp: player.maxHp, stats: player.stats },
    opponent: { name: opponent.name, hp: opponent.hp, maxHp: opponent.maxHp, stats: opponent.stats },
    rounds,
    xpGained: f.xp_gained,
    createdAt: f.created_at,
    finishedAt: f.finished_at,
  };
}

export async function fightRoutes(app: FastifyInstance) {
  const { pool, rng } = app.deps;
  app.addHook("onRequest", app.authenticate);

  const activeFight = async (userId: string) =>
    (await pool.query<FightRow>("SELECT * FROM fights WHERE user_id = $1 AND status = 'active'", [userId])).rows[0];

  // Starts a fight against a bot, or returns the one already in progress.
  app.post("/", async (req, reply) => {
    const existing = await activeFight(req.user.sub);
    if (existing) return toView(existing);
    const user = await findUserById(pool, req.user.sub);
    if (!user) throw new HttpError(401, "unauthorized", "Аккаунт не найден");
    const bot = makeBot(user.level, rng);
    const state = newFight(makeFighter(user.username, user.stats), makeFighter(bot.name, bot.stats));
    const { rows } = await pool.query<FightRow>(
      `INSERT INTO fights (user_id, opponent, status, state) VALUES ($1, $2, 'active', $3)
       ON CONFLICT (user_id) WHERE status = 'active' DO NOTHING RETURNING *`,
      [user.id, bot.name, state],
    );
    // A concurrent request may have created the fight first.
    if (!rows[0]) return toView((await activeFight(user.id))!);
    return reply.status(201).send(toView(rows[0]));
  });

  app.get("/active", async (req) => {
    const fight = await activeFight(req.user.sub);
    if (!fight) throw new HttpError(404, "no_active_fight", "Активного боя нет");
    return toView(fight);
  });

  // Finished fights, newest first. Pass the last id as `before` to page.
  app.get("/", async (req) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.number().int().optional() })
      .parse(req.query);
    const { rows } = await pool.query<FightRow>(
      `SELECT * FROM fights WHERE user_id = $1 AND status = 'finished' AND ($2::bigint IS NULL OR id < $2)
       ORDER BY id DESC LIMIT $3`,
      [req.user.sub, q.before ?? null, q.limit],
    );
    return {
      items: rows.map((f) => ({
        id: f.id,
        opponent: f.opponent,
        result: f.result,
        rounds: f.state.rounds.length,
        xpGained: f.xp_gained,
        finishedAt: f.finished_at,
      })),
      nextBefore: rows.length === q.limit ? rows[rows.length - 1].id : null,
    };
  });

  app.get("/:id", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const { rows } = await pool.query<FightRow>("SELECT * FROM fights WHERE id = $1 AND user_id = $2", [id, req.user.sub]);
    if (!rows[0]) throw new HttpError(404, "not_found", "Бой не найден");
    return toView(rows[0]);
  });

  app.post("/:id/turn", async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const move = moveSchema.parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query<FightRow>(
        "SELECT * FROM fights WHERE id = $1 AND user_id = $2 FOR UPDATE",
        [id, req.user.sub],
      );
      const fight = rows[0];
      if (!fight) throw new HttpError(404, "not_found", "Бой не найден");
      if (fight.status !== "active") throw new HttpError(409, "fight_finished", "Бой уже закончен");

      const state = playRound(fight.state, move, randomMove(rng), rng);
      let updated: FightRow;
      if (state.result) {
        const xpGained = xpFor(state.result);
        const user = (await findUserById(client, req.user.sub, true))!;
        const lv = applyXp(user.level, user.xp, xpGained);
        await client.query(
          `UPDATE users SET level = $2, xp = $3, free_points = free_points + $4,
             wins = wins + $5, losses = losses + $6, draws = draws + $7 WHERE id = $1`,
          [user.id, lv.level, lv.xp, lv.levelsGained, +(state.result === "win"), +(state.result === "loss"), +(state.result === "draw")],
        );
        updated = (
          await client.query<FightRow>(
            `UPDATE fights SET state = $2, status = 'finished', result = $3, xp_gained = $4, finished_at = now()
             WHERE id = $1 RETURNING *`,
            [fight.id, state, state.result, xpGained],
          )
        ).rows[0];
      } else {
        updated = (await client.query<FightRow>("UPDATE fights SET state = $2 WHERE id = $1 RETURNING *", [fight.id, state])).rows[0];
      }
      await client.query("COMMIT");
      return toView(updated);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
