function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Environment variable ${name} is required`);
  return value;
}

const isProd = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl: required("DATABASE_URL", isProd ? undefined : "postgres://arena:arena@localhost:5432/arena"),
  jwtSecret: required("JWT_SECRET", isProd ? undefined : "dev-secret-change-me"),
  tokenTtl: process.env.TOKEN_TTL ?? "30d",
};
