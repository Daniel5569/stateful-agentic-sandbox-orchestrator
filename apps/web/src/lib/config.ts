export const config = {
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgresql://orchestrator:change-me-in-production@localhost:5432/sandbox_orchestrator",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379"
};
