import IORedis, { Redis } from "ioredis";
import { env } from "../config/env";

// BullMQ requires maxRetriesPerRequest: null on any connection it drives
// (Worker, QueueEvents). We reuse one such connection for the plain
// Redis operations too (rate-limit counters, Slack-notified flags).
//
// Free managed Redis providers (e.g. Upstash) hand out a single
// `rediss://...` TLS URL rather than separate host/port/password -- REDIS_URL
// is honored first so those work with zero extra config, otherwise we fall
// back to the discrete host/port/password vars (set REDIS_TLS=true if that
// host also requires TLS).
export function createRedisConnection(): Redis {
  if (env.redisUrl) {
    return new IORedis(env.redisUrl, { maxRetriesPerRequest: null });
  }
  return new IORedis({
    host: env.redisHost,
    port: env.redisPort,
    password: env.redisPassword,
    tls: env.redisTls ? {} : undefined,
    maxRetriesPerRequest: null,
  });
}

export const redis = createRedisConnection();
