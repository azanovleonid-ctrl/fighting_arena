import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Arena, type Client } from "../arena/rooms.js";
import { MODES, WEAPONS, type Mode, type Weapon } from "../arena/sim.js";
import { findUserById, settingsSchema } from "../users.js";

export async function arenaRoutes(app: FastifyInstance, opts: { arena: Arena }) {
  const { pool } = app.deps;
  const { arena } = opts;

  // Real-time play. The token goes in the query string because browsers and many WS clients cannot set headers.
  app.get("/arena", { websocket: true }, async (socket, req) => {
    const { token } = z.object({ token: z.string() }).parse(req.query);
    let userId: string;
    try {
      userId = app.jwt.verify<{ sub: string }>(token).sub;
    } catch {
      socket.close(4401, "unauthorized");
      return;
    }
    const user = await findUserById(pool, userId);
    if (!user) {
      socket.close(4401, "unauthorized");
      return;
    }
    const client: Client = {
      userId: user.id,
      name: user.username,
      stats: user.stats,
      weapon: settingsSchema.parse(user.settings).weapon,
      send: (msg) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    };
    socket.on("message", (raw) => {
      let msg: { t?: unknown; mode?: unknown; weapon?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.t === "play") {
        if (WEAPONS.includes(msg.weapon as Weapon)) client.weapon = msg.weapon as Weapon;
        arena.join(client, MODES.includes(msg.mode as Mode) ? (msg.mode as Mode) : "brawl");
      }
      else if (msg.t === "leave") arena.leave(client);
      else if (typeof msg.t === "string") arena.input(client, msg as { t: string });
    });
    socket.on("close", () => arena.leave(client));
    client.send({ t: "hello", name: user.username });
  });

  // Finished matches, newest first. Pass the last id as `before` to page.
  app.get("/matches", { onRequest: app.authenticate }, async (req) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20), before: z.coerce.number().int().optional() })
      .parse(req.query);
    const { rows } = await pool.query(
      `SELECT id, mode, place, players, kills, deaths, goals, damage, result, xp_gained AS "xpGained", created_at AS "createdAt"
       FROM matches WHERE user_id = $1 AND ($2::bigint IS NULL OR id < $2) ORDER BY id DESC LIMIT $3`,
      [req.user.sub, q.before ?? null, q.limit],
    );
    return { items: rows, nextBefore: rows.length === q.limit ? rows[rows.length - 1].id : null };
  });
}
