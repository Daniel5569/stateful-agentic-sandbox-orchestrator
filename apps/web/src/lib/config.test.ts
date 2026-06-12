import { afterEach, describe, expect, it, vi } from "vitest";

describe("config production safety", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  it("allows development defaults for local demo runs", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;

    const { config } = await import("./config");

    expect(config.databaseUrl).toContain("sandbox_orchestrator");
    expect(config.redisUrl).toBe("redis://localhost:6379");
  });

  it("rejects insecure database defaults in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENV;
    process.env.DATABASE_URL =
      "postgresql://orchestrator:change-me-in-production@postgres:5432/sandbox_orchestrator";
    process.env.REDIS_URL = "redis://redis:6379";

    await expect(import("./config")).rejects.toThrow("DATABASE_URL_uses_insecure_default");
  });

  it("does not require runtime secrets during Next production build", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PHASE = "phase-production-build";
    delete process.env.APP_ENV;
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;

    const { config } = await import("./config");

    expect(config.databaseUrl).toContain("sandbox_orchestrator");
  });

  it("requires redis configuration in production", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.APP_ENV;
    process.env.DATABASE_URL = "postgresql://orchestrator:prod-secret@postgres:5432/sandbox_orchestrator";
    delete process.env.REDIS_URL;

    await expect(import("./config")).rejects.toThrow("REDIS_URL_required_in_production");
  });
});
