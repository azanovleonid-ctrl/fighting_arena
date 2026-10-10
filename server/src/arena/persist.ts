import type pg from "pg";
import { applyXp } from "../game/progression.js";
import type { Placement } from "./sim.js";

/** XP for one match: placement bonus plus two per kill. */
export function xpForMatch(place: number, kills: number): number {
  const base = place === 1 ? 20 : place <= 3 ? 10 : 5;
  return base + kills * 2;
}

/** Saves each human's result and updates their level and record. Returns XP gained per user id. */
export async function saveMatch(pool: pg.Pool, humans: Placement[], playerCount: number): Promise<Map<string, number>> {
  const gained = new Map<string, number>();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const r of humans) {
      if (!r.userId) continue;
      const xp = xpForMatch(r.place, r.kills);
      const win = r.place === 1;
      const { rows } = await client.query<{ level: number; xp: number }>(
        "SELECT level, xp FROM users WHERE id = $1 FOR UPDATE",
        [r.userId],
      );
      if (!rows[0]) continue;
      const lv = applyXp(rows[0].level, rows[0].xp, xp);
      await client.query(
        `UPDATE users SET level = $2, xp = $3, free_points = free_points + $4, wins = wins + $5, losses = losses + $6
         WHERE id = $1`,
        [r.userId, lv.level, lv.xp, lv.levelsGained, +win, +!win],
      );
      await client.query(
        `INSERT INTO matches (user_id, place, players, kills, deaths, damage, result, xp_gained)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [r.userId, r.place, playerCount, r.kills, r.deaths, r.damage, win ? "win" : "loss", xp],
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
