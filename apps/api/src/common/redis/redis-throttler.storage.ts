import { Injectable } from '@nestjs/common';
import { ThrottlerStorageService, type ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

/**
 * Mirrors @nestjs/throttler in-memory storage:
 * - While blocked, do not increment hits (each request only reads remaining block TTL).
 * - When the block key expires but the hit counter is still above the limit, reset hits
 *   so the user gets a fresh allowance (otherwise every post-block request re-blocks for the full duration).
 */
const LUA_INCREMENT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttlMs = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDurationMs = tonumber(ARGV[3])

local blockPttl = redis.call('PTTL', blockKey)
if blockPttl < 0 then
  blockPttl = 0
end

local isBlocked = blockPttl > 0 and 1 or 0
local hits = 0

if isBlocked == 1 then
  hits = tonumber(redis.call('GET', hitsKey) or '0')
else
  local prevHits = tonumber(redis.call('GET', hitsKey) or '0')
  if prevHits > limit then
    redis.call('DEL', hitsKey)
  end
  hits = redis.call('INCR', hitsKey)
  if hits == 1 then
    redis.call('PEXPIRE', hitsKey, ttlMs)
  end
  if hits > limit and blockDurationMs > 0 then
    redis.call('SET', blockKey, '1', 'PX', blockDurationMs)
  end
end

local hitsPttl = redis.call('PTTL', hitsKey)
local timeToExpireMs = ttlMs
if hitsPttl > 0 then
  timeToExpireMs = hitsPttl
end

local finalBlockPttl = redis.call('PTTL', blockKey)
if finalBlockPttl < 0 then
  finalBlockPttl = 0
end

isBlocked = finalBlockPttl > 0 and 1 or 0

return { hits, timeToExpireMs, isBlocked, finalBlockPttl }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly fallback = new ThrottlerStorageService();

  constructor(private readonly redis: RedisService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<{ totalHits: number; timeToExpire: number; isBlocked: boolean; timeToBlockExpire: number }> {
    if (!this.redis.isReady()) {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    const redisKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${redisKey}:blocked`;

    try {
      const result = (await this.redis.eval(LUA_INCREMENT, [redisKey, blockKey], [
        String(ttl),
        String(limit),
        String(blockDuration),
      ])) as [number, number, number, number];

      const totalHits = Number(result?.[0] ?? 0);
      const timeToExpireMs = Math.max(0, Number(result?.[1] ?? 0));
      const isBlocked = Number(result?.[2] ?? 0) === 1;
      const timeToBlockExpireMs = Math.max(0, Number(result?.[3] ?? 0));

      // Match ThrottlerStorageService: time values are in whole seconds for guards/headers.
      const timeToExpire = Math.max(0, Math.ceil(timeToExpireMs / 1000));
      const timeToBlockExpire = Math.max(0, Math.ceil(timeToBlockExpireMs / 1000));

      return { totalHits, timeToExpire, isBlocked, timeToBlockExpire };
    } catch {
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }
  }
}
