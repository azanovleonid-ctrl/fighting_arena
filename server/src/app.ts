import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyWebsocket from "@fastify/websocket";
import type pg from "pg";
import { ZodError } from "zod";
import { Arena, DEFAULT_ARENA, type ArenaOptions } from "./arena/rooms.js";
import { saveMatch } from "./arena/persist.js";
import type { Rng } from "./arena/sim.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { arenaRoutes } from "./routes/arena.js";

export interface AppDeps {
  pool: pg.Pool;
  jwtSecret: string;
  tokenTtl?: string;
  rng?: Rng;
  logger?: boolean;
  arena?: Partial<Omit<ArenaOptions, "rng" | "onFinish">>;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    deps: Required<Omit<AppDeps, "logger" | "arena">>;
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

export async function buildApp(deps: AppDeps) {
  const app = Fastify({ logger: deps.logger ?? false });
  app.decorate("deps", { tokenTtl: "30d", rng: Math.random, ...deps } as Required<Omit<AppDeps, "logger" | "arena">>);

  await app.register(fastifyJwt, { secret: deps.jwtSecret, sign: { expiresIn: deps.tokenTtl ?? "30d" } });
  app.decorate("authenticate", async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new HttpError(401, "unauthorized", "Нужно войти в аккаунт");
    }
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: "validation", message: "Некорректные данные", details: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: "bad_request", message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: "internal", message: "Внутренняя ошибка сервера" });
  });

  app.get("/health", async () => {
    await deps.pool.query("SELECT 1");
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: "/auth" });
  await app.register(profileRoutes, { prefix: "/me" });
  const arena = new Arena({
    ...DEFAULT_ARENA,
    ...deps.arena,
    rng: deps.rng ?? Math.random,
    onFinish: (humans, count) => saveMatch(deps.pool, humans, count),
  });
  app.addHook("onClose", async () => arena.shutdown());
  await app.register(fastifyWebsocket);
  await app.register(arenaRoutes, { arena });
  return app;
}
