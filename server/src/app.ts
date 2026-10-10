import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type pg from "pg";
import { ZodError } from "zod";
import type { Rng } from "./game/engine.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { fightRoutes } from "./routes/fights.js";

export interface AppDeps {
  pool: pg.Pool;
  jwtSecret: string;
  tokenTtl?: string;
  rng?: Rng;
  logger?: boolean;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

declare module "fastify" {
  interface FastifyInstance {
    deps: Required<Omit<AppDeps, "logger">>;
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
  app.decorate("deps", { tokenTtl: "30d", rng: Math.random, ...deps } as Required<Omit<AppDeps, "logger">>);

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
  await app.register(fightRoutes, { prefix: "/fights" });
  return app;
}
