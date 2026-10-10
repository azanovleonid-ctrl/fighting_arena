import type pg from "pg";

// Append-only: never edit a migration that has shipped, add a new one instead.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    level         INT NOT NULL DEFAULT 1,
    xp            INT NOT NULL DEFAULT 0,
    free_points   INT NOT NULL DEFAULT 0,
    stats         JSONB NOT NULL,
    settings      JSONB NOT NULL DEFAULT '{}',
    wins          INT NOT NULL DEFAULT 0,
    losses        INT NOT NULL DEFAULT 0,
    draws         INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX users_username_lower ON users (lower(username));

  CREATE TABLE fights (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opponent    TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('active', 'finished')),
    result      TEXT CHECK (result IN ('win', 'loss', 'draw')),
    state       JSONB NOT NULL,
    xp_gained   INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
  );
  CREATE UNIQUE INDEX fights_one_active_per_user ON fights (user_id) WHERE status = 'active';
  CREATE INDEX fights_user_history ON fights (user_id, id DESC);
  `,
  `
  DROP TABLE fights;
  CREATE TABLE matches (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    place      INT NOT NULL,
    players    INT NOT NULL,
    kills      INT NOT NULL,
    deaths     INT NOT NULL,
    damage     INT NOT NULL,
    result     TEXT NOT NULL CHECK (result IN ('win', 'loss')),
    xp_gained  INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX matches_user_history ON matches (user_id, id DESC);
  `,
  `
  ALTER TABLE matches ADD COLUMN mode TEXT NOT NULL DEFAULT 'brawl';
  ALTER TABLE matches ADD COLUMN goals INT NOT NULL DEFAULT 0;
  ALTER TABLE matches DROP CONSTRAINT matches_result_check;
  ALTER TABLE matches ADD CONSTRAINT matches_result_check CHECK (result IN ('win', 'loss', 'draw'));
  `,
];

export async function migrate(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(424242)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const { rows } = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    for (const [i, sql] of MIGRATIONS.entries()) {
      const version = i + 1;
      if (applied.has(version)) continue;
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(424242)").catch(() => {});
    client.release();
  }
}
