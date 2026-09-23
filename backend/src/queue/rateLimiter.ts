import { redis } from "../lib/redis";

const HOUR_MS = 60 * 60 * 1000;

function hourWindowKey(senderId: string, windowStart: number): string {
  return `ratelimit:sender:${senderId}:${windowStart}`;
}

function slackNotifiedKey(senderId: string, windowStart: number): string {
  return `slacknotified:sender:${senderId}:${windowStart}`;
}

export function currentHourWindow(at: number = Date.now()): number {
  return Math.floor(at / HOUR_MS) * HOUR_MS;
}

export function nextHourWindow(at: number = Date.now()): number {
  return currentHourWindow(at) + HOUR_MS;
}

/**
 * Atomically reserves one "send slot" for a sender in the current hour
 * window. Safe across multiple worker processes/instances because the
 * increment + limit check happen in a single Lua script executed by Redis.
 *
 * Returns true if the slot was reserved (caller may send), false if the
 * sender's hourly cap has already been reached for this window.
 */
const RESERVE_SLOT_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local count = redis.call("INCR", key)
if count == 1 then
  redis.call("EXPIRE", key, ttl)
end
if count > limit then
  return 0
else
  return 1
end
`;

export async function tryReserveSendSlot(senderId: string, hourlyLimit: number): Promise<boolean> {
  const windowStart = currentHourWindow();
  const key = hourWindowKey(senderId, windowStart);
  const result = await redis.eval(RESERVE_SLOT_SCRIPT, 1, key, String(hourlyLimit), "3600");
  return result === 1;
}

/**
 * Ensures we only ping Slack once per (sender, hour window) instead of once
 * per throttled job, which would otherwise spam the channel.
 */
export async function shouldNotifySlackForWindow(senderId: string): Promise<boolean> {
  const windowStart = currentHourWindow();
  const key = slackNotifiedKey(senderId, windowStart);
  // SET ... NX returns "OK" only the first time it's called for this key.
  const result = await redis.set(key, "1", "EX", 3600, "NX");
  return result === "OK";
}

export async function currentSenderHourlyCount(senderId: string): Promise<number> {
  const windowStart = currentHourWindow();
  const value = await redis.get(hourWindowKey(senderId, windowStart));
  return value ? Number(value) : 0;
}
