import type pg from "pg";
import { applyXp } from "../game/progression.js";
import type { Mode, Placement } from "./sim.js";

/** XP for one match: result or placement bonus, plus two per kill and five per goal. */
export function xpForMatch(mode: Mode, r: Placement): number {
  const base =
    mode === "football"
      ? { win: 20, draw: 10, loss: 5 }[r.result]
      : r.place === 1 ? 20 : r.place <= 3 ? 10 : 5;
  return base + r.kills * 2 + r.goals * 5;
}

/** Saves each human's result and updates their level and record. Returns XP gained per user id. */
export async function saveMatch(pool: pg.Pool, mode: Mode, humans: Placement[], playerCount: number): Promise<Map<string, number>> {
  const gained = new Map<string, number>();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of humans) {
      if (!r.userId) continue;
      const xp = xpForMatch(mode, r);
      const { rows } = await client.query<{ level: number; xp: number }>(
        "SELECT level, xp FROM users WHERE id = $1 FOR UPDATE",
        [r.userId],
      );
      if (!rows[0]) continue;
      const lv = applyXp(rows[0].level, rows[0].xp, xp);
      await client.query(
        `UPDATE users SET level = $2, xp = $3, free_points = free_points + $4,
           wins = wins + $5, losses = losses + $6, draws = draws + $7 WHERE id = $1`,
        [r.userId, lv.level, lv.xp, lv.levelsGained, +(r.result === "win"), +(r.result === "loss"), +(r.result === "draw")],
      );
      await client.query(
        `INSERT INTO matches (user_id, mode, place, players, kills, deaths, goals, damage, result, xp_gained)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [r.userId, mode, r.place, playerCount, r.kills, r.deaths, r.goals, r.damage, r.result, xp],
      );
      gained.set(r.userId, xp);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return gained;
}
