import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createClient } from "redis";
import { closeRedisClientForTests } from "../../../lib/queue";
import { pool as appPool } from "../../../lib/db";

const shouldRun = process.env.RUN_DB_INTEGRATION === "1";

describe.skipIf(!shouldRun)("POST /api/runs integration", () => {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://orchestrator:change-me-in-production@localhost:5432/sandbox_orchestrator";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const pool = new Pool({ connectionString: databaseUrl });
  const redis = createClient({ url: redisUrl });

  beforeAll(async () => {
    const initSql = fs.readFileSync(path.resolve(process.cwd(), "../../infra/db/init.sql"), "utf-8");
    await pool.query(initSql);
    await pool.query("TRUNCATE run_events, runs, policies RESTART IDENTITY CASCADE");
    await redis.connect();
    await redis.flushDb();
  });

  afterAll(async () => {
    await closeRedisClientForTests();
    await appPool.end();
    await redis.quit();
    await pool.end();
  });

  it("accepts a run, persists it in PostgreSQL, and enqueues a Redis stream entry", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("http://localhost:3000/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "integration-agent",
          command: "python task.py",
          workspaceRef: "demo",
          policyYaml: `
policy_id: integration-policy
network:
  allow: false
filesystem:
  writable_paths:
    - /workspace
execution:
  max_seconds: 30
  denied_commands:
    - curl
`
        })
      })
    );

    expect(response.status).toBe(202);
    const body = await response.json();

    const run = await pool.query("SELECT status, policy_id FROM runs WHERE id = $1", [body.runId]);
    expect(run.rows[0]).toMatchObject({ status: "queued", policy_id: "integration-policy" });

    const streamLength = await redis.xLen("sandbox-runs");
    expect(streamLength).toBe(1);
  });
});
