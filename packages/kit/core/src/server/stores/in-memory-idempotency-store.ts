import type { IdempotencyStore, StoredResponse } from '../idempotency.js';

interface CacheEntry {
  response: StoredResponse;
  expiresAt: number;
}

/**
 * In-memory idempotency store for development and testing.
 * NOT suitable for production -- use a Redis-backed implementation instead.
 */
export const createInMemoryIdempotencyStore = (): IdempotencyStore => {
  const cache = new Map<string, CacheEntry>();
  const locks = new Set<string>();

  const evictExpired = () => {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
  };

  return {
    async get(key) {
      evictExpired();
      return cache.get(key)?.response;
    },

    async set(key, response, ttlMs) {
      cache.set(key, { response, expiresAt: Date.now() + ttlMs });
    },

    async tryLock(key, _ttlMs) {
      if (locks.has(key)) return false;
      locks.add(key);
      return true;
    },

    async unlock(key) {
      locks.delete(key);
    },
  };
};
