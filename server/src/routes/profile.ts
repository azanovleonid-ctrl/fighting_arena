import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../app.js";
import { findUserById, settingsSchema, toProfile } from "../users.js";

const statPoints = z
  .object({
    strength: z.number().int().min(0).default(0),
    agility: z.number().int().min(0).default(0),
    intuition: z.number().int().min(0).default(0),
    endurance: z.number().int().min(0).default(0),
  })
  .strict();

export async function profileRoutes(app: FastifyInstance) {
  const { pool } = app.deps;
  app.addHook("onRequest", app.authenticate);

  app.get("/", async (req) => {
    const user = await findUserById(pool, req.user.sub);
    if (!user) throw new HttpError(401, "unauthorized", "Аккаунт не найден");
    return toProfile(user);
  });

  app.get("/settings", async (req) => {
    const user = await findUserById(pool, req.user.sub);
    if (!user) throw new HttpError(401, "unauthorized", "Аккаунт не найден");
    return settingsSchema.parse(user.settings);
  });

  // Partial update: only the keys sent are changed.
  app.patch("/settings", async (req) => {
    const patch = settingsSchema.partial().strict().parse(req.body);
    const user = await findUserById(pool, req.user.sub);
    if (!user) throw new HttpError(401, "unauthorized", "Аккаунт не найден");
    const settings = settingsSchema.parse({ ...user.settings, ...patch });
    await pool.query("UPDATE users SET settings = $2 WHERE id = $1", [user.id, settings]);
    return settings;
  });

  // Spends free points earned on level-up.
  app.post("/stats", async (req) => {
    const add = statPoints.parse(req.body);
    const spent = add.strength + add.agility + add.intuition + add.endurance;
    if (spent === 0) throw new HttpError(400, "nothing_to_spend", "Распределите хотя бы одно очко");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const user = await findUserById(client, req.user.sub, true);
      if (!user) throw new HttpError(401, "unauthorized", "Аккаунт не найден");
      if (spent > user.free_points) throw new HttpError(400, "not_enough_points", "Недостаточно свободных очков");
      const stats = {
        strength: user.stats.strength + add.strength,
        agility: user.stats.agility + add.agility,
        intuition: user.stats.intuition + add.intuition,
        endurance: user.stats.endurance + add.endurance,
      };
      await client.query("UPDATE users SET stats = $2, free_points = free_points - $3 WHERE id = $1", [user.id, stats, spent]);
      await client.query("COMMIT");
      return toProfile({ ...user, stats, free_points: user.free_points - spent });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
