import type { Redis } from 'ioredis';

import type { DB } from '#db/schema.ts';
import type { Trx } from '@kit/db/transaction';
import {
  createMailSuppressionsRepository as factory,
  type MailSuppressionsRepository as KitMailSuppressionsRepository,
  type SuppressionCache,
} from '@kit/mailer';
import type { TenantContext } from '@kit/tenancy';

interface MailSuppressionsRepositoryDeps {
  transaction: Trx<DB>;
  tenantContext: TenantContext;
  redis: Redis;
}

/**
 * Adapt the consumer's ioredis client to the slim `SuppressionCache`
 * interface the kit needs. Keeps the kit free of an `ioredis` peer-dep
 * type while letting the service use its existing Redis connection.
 */
const cacheFromRedis = (redis: Redis): SuppressionCache => ({
  sismember: (key, member) => redis.sismember(key, member),
  sadd: (key, ...members) => redis.sadd(key, ...members),
  srem: (key, ...members) => redis.srem(key, ...members),
  expire: (key, ttlSeconds) => redis.expire(key, ttlSeconds),
  del: (key) => redis.del(key),
});

export const createMailSuppressionsRepository = ({
  transaction,
  tenantContext,
  redis,
}: MailSuppressionsRepositoryDeps): KitMailSuppressionsRepository<DB> =>
  factory<DB>({
    transaction,
    tenantContext,
    cache: cacheFromRedis(redis),
  });

export type MailSuppressionsRepository = ReturnType<
  typeof createMailSuppressionsRepository
>;
