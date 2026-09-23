import IORedis, { Redis } from "ioredis";
import { env } from "../config/env";

// BullMQ requires maxRetriesPerRequest: null on any connection it drives
// (Worker, QueueEvents). We reuse one such connection for the plain
// Redis operations too (rate-limit counters, Slack-notified flags).
export function createRedisConnection(): Redis {
  return new IORedis({
    host: env.redisHost,
    port: env.redisPort,
    password: env.redisPassword,
    maxRetriesPerRequest: null,
  });
}

export const redis = createRedisConnection();
