import type { Redis } from 'ioredis';

import type { TokenBlacklistStore } from '@kit/auth';

const BLACKLIST_PREFIX = 'auth:blacklist:';
const CLEARED_PREFIX = 'auth:cleared:';

/**
 * Redis-backed token blacklist. Used by @kit/auth for JWT revocation.
 *
 * Keys:
 * - `auth:blacklist:{jti}` = "1", TTL = refresh TTL + 6h
 * - `auth:cleared:{userId}` = unix timestamp, TTL = refresh TTL + 6h
 */
export const createTokenBlacklistService = ({
  redis,
}: {
  redis: Redis;
}): TokenBlacklistStore => ({
  async blacklistToken(jti, ttlSeconds) {
    await redis.set(`${BLACKLIST_PREFIX}${jti}`, '1', 'EX', ttlSeconds);
  },

  async isBlacklisted(jti) {
    const result = await redis.exists(`${BLACKLIST_PREFIX}${jti}`);
    return result === 1;
  },

  async setClearedAt(userId, timestamp, ttlSeconds) {
    await redis.set(
      `${CLEARED_PREFIX}${userId}`,
      String(timestamp),
      'EX',
      ttlSeconds,
    );
  },

  async getClearedAt(userId) {
    const value = await redis.get(`${CLEARED_PREFIX}${userId}`);
    return value === null ? null : Number(value);
  },
});
