import { createClient } from "redis";
import { config } from "./config";

export type SandboxRunJob = {
  runId: string;
  agentId: string;
  command: string;
  workspaceRef: string;
  policyId: string;
};

export const SANDBOX_RUN_STREAM = "sandbox-runs";

type RedisClient = ReturnType<typeof createClient>;

const globalForRedis = globalThis as unknown as { redisClientPromise?: Promise<RedisClient> };

export async function getRedisClient(): Promise<RedisClient> {
  if (!globalForRedis.redisClientPromise) {
    globalForRedis.redisClientPromise = (async () => {
      const client = createClient({ url: config.redisUrl });
      client.on("error", (error) => {
        console.error("redis_client_error", error);
      });
      await client.connect();
      return client;
    })().catch((error) => {
      globalForRedis.redisClientPromise = undefined;
      throw error;
    });
  }

  return globalForRedis.redisClientPromise;
}

export async function enqueueSandboxRun(job: SandboxRunJob): Promise<string> {
  const client = await getRedisClient();
  return client.xAdd(SANDBOX_RUN_STREAM, "*", {
    payload: JSON.stringify(job)
  });
}

export async function closeRedisClientForTests(): Promise<void> {
  const client = await globalForRedis.redisClientPromise;
  if (client?.isOpen) {
    await client.quit();
  }
  globalForRedis.redisClientPromise = undefined;
}
