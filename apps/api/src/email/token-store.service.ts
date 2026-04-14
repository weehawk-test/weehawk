import { Injectable } from '@nestjs/common';

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

  set(key: string, value: string, ttlMs: number): void {
    this.store.set(key, { value, expiry: Date.now() + ttlMs });
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}
