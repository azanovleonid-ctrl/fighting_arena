import pg from "pg";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { migrate } from "./db/migrations.js";

const pool = new pg.Pool({ connectionString: config.databaseUrl });
await migrate(pool);
const app = await buildApp({ pool, jwtSecret: config.jwtSecret, tokenTtl: config.tokenTtl, logger: true });
await app.listen({ port: config.port, host: config.host });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
