import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../app.js";
import { BASE_STATS } from "../game/engine.js";
import { hashPassword, verifyPassword } from "../password.js";
import { toProfile, type UserRow } from "../users.js";

const credentials = z.object({
  username: z.string().trim().regex(/^[\p{L}\p{N}_]{3,20}$/u, "3–20 букв, цифр или _"),
  password: z.string().min(6).max(100),
});

export async function authRoutes(app: FastifyInstance) {
  const { pool } = app.deps;
  const issue = (user: UserRow) => ({ token: app.jwt.sign({ sub: user.id }), user: toProfile(user) });

  app.post("/register", async (req, reply) => {
    const { username, password } = credentials.parse(req.body);
    try {
      const { rows } = await pool.query<UserRow>(
        "INSERT INTO users (username, password_hash, stats) VALUES ($1, $2, $3) RETURNING *",
        [username, await hashPassword(password), BASE_STATS],
      );
      return reply.status(201).send(issue(rows[0]));
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        throw new HttpError(409, "username_taken", "Это имя уже занято");
      }
      throw err;
    }
  });

  app.post("/login", async (req) => {
    const { username, password } = z.object({ username: z.string().trim(), password: z.string() }).parse(req.body);
    const { rows } = await pool.query<UserRow>("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
    const user = rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(401, "invalid_credentials", "Неверное имя или пароль");
    }
    return issue(user);
  });
}
