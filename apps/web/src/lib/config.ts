const DEFAULT_DATABASE_URL =
  "postgresql://orchestrator:change-me-in-production@localhost:5432/sandbox_orchestrator";
const DEFAULT_REDIS_URL = "redis://localhost:6379";
const INSECURE_DEFAULT_MARKER = "change-me-in-production";

function isProductionRuntime(): boolean {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return false;
  }
  return process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";
}

function allowsDevelopmentDefaults(): boolean {
  return process.env.APP_ENV === "development" || process.env.ALLOW_INSECURE_DEV_DEFAULTS === "1";
}

function assertProductionSafe(name: string, value: string | undefined, fallback: string): string {
  const resolved = value ?? fallback;

  if (isProductionRuntime() && !allowsDevelopmentDefaults()) {
    if (!value) {
      throw new Error(`${name}_required_in_production`);
    }
    if (resolved.includes(INSECURE_DEFAULT_MARKER)) {
      throw new Error(`${name}_uses_insecure_default`);
    }
  }

  return resolved;
}

export const config = {
  databaseUrl: assertProductionSafe("DATABASE_URL", process.env.DATABASE_URL, DEFAULT_DATABASE_URL),
  redisUrl: assertProductionSafe("REDIS_URL", process.env.REDIS_URL, DEFAULT_REDIS_URL)
};
