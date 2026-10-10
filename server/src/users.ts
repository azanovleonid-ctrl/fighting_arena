import type pg from "pg";
import { z } from "zod";
import { maxHpFor, xpToNextLevel, type Stats } from "./game/engine.js";

export const settingsSchema = z.object({
  language: z.enum(["ru", "en"]).default("ru"),
  theme: z.enum(["dark", "light"]).default("dark"),
  sound: z.boolean().default(true),
  vibration: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  level: number;
  xp: number;
  free_points: number;
  stats: Stats;
  settings: Partial<Settings>;
  wins: number;
  losses: number;
  draws: number;
  created_at: Date;
}

export async function findUserById(db: pg.Pool | pg.PoolClient, id: string, lock = false): Promise<UserRow | null> {
  const { rows } = await db.query<UserRow>(`SELECT * FROM users WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  return rows[0] ?? null;
}

export function toProfile(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    level: u.level,
    xp: u.xp,
    xpToNextLevel: xpToNextLevel(u.level),
    freePoints: u.free_points,
    stats: u.stats,
    maxHp: maxHpFor(u.stats),
    record: { wins: u.wins, losses: u.losses, draws: u.draws },
    settings: settingsSchema.parse(u.settings),
    createdAt: u.created_at,
  };
}
