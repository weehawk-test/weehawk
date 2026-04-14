import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis/redis.service';

interface StoredValue {
  value: string;
  expiry: number;
}

/**
 * In-memory token store (replace with Redis in production).
 * Keys are prefixed; values expire after TTL ms.
 */
@Injectable()
export class TokenStoreService {
  private readonly store = new Map<string, StoredValue>();
  constructor(private readonly redis: RedisService) {}

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (this.redis.isReady()) {
      try {
        await this.redis.setWithTtlMs(key, value, ttlMs);
        return;
      } catch {
        // Fallback to in-memory store if Redis is temporarily unavailable.
      }
    }
    this.store.set(key, { value, expiry: Date.now() + ttlMs });
  }

  async get(key: string): Promise<string | null> {
    if (this.redis.isReady()) {
      try {
        return await this.redis.get(key);
      } catch {
        // Fallback to in-memory store if Redis is temporarily unavailable.
      }
    }
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async delete(key: string): Promise<void> {
    if (this.redis.isReady()) {
      try {
        await this.redis.del(key);
      } catch {
        // Continue with in-memory cleanup.
      }
    }
    this.store.delete(key);
  }
}
